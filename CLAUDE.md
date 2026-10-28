# CLAUDE.md — GitPilot project instructions

> Read this file and `DEVELOPMENT.md` before making substantial changes.
> `DEVELOPMENT.md` holds live status; this file holds stable architecture and conventions.

## Project overview

GitPilot is a cross-platform (Windows + Linux) desktop Git manager. It manages multiple
repositories, shows working-tree changes and diffs, stages/unstages (file and hunk level),
commits, browses history, manages branches and remotes, runs fetch/pull/push, generates
optional AI help (commit messages, explanations, pull request descriptions, conflict
suggestions), works with GitHub (sign-in, clone from your list, pull requests), and launches
Claude Code in a repository.

Audience: beginners who want Git explained, and experienced developers who want a fast,
precise GUI. Core principle: make Git understandable, make risky operations safe, feel like
real desktop software.

Stack: Tauri 2 (Rust) · React 19 · TypeScript (strict) · Vite · Tailwind CSS 4 · Lucide icons ·
SQLite (rusqlite, bundled) · OS keychain via `keyring`. Supported OS: Windows, Linux.
(macOS is not a target; code avoids blocking it but nothing is tested there.)

## Architecture

```
React UI ──invoke()──▶ Tauri commands (src-tauri/src/commands/*) ──▶ domain modules
                                                                      ├─ git/      (runs the git executable)
                                                                      ├─ db.rs     (SQLite: repo registry)
                                                                      ├─ settings.rs (JSON settings file)
                                                                      ├─ secrets.rs  (OS keychain)
                                                                      ├─ ai.rs       (AI providers + prompts)
                                                                      ├─ github.rs   (GitHub API, device-flow sign-in)
                                                                      ├─ github_pr.rs (PR review, merge, issues)
                                                                      ├─ editors.rs  (code editors, terminal here)
                                                                      ├─ cli.rs      (terminal launch, version probe for CLIs)
                                                                      ├─ claude_code.rs / opencode.rs (coding assistants)
                                                                      ├─ signing_keys.rs (SSH/GPG keys that can sign)
                                                                      ├─ watch.rs    (auto-refresh file watcher)
                                                                      └─ updates.rs  (install kind; Arch updates through pacman)
```

### Git execution layer (`src-tauri/src/git/`)
- `runner.rs`: the ONLY place processes for git are spawned. Uses `tokio::process::Command`
  with an argument vector — never a shell, never string concatenation. Sets
  `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` (file names are never globs),
  `LC_ALL=C` (stable error text for classification), `GIT_OPTIONAL_LOCKS=0` for reads,
  null stdin (unless a patch/message is piped), a timeout, and `CREATE_NO_WINDOW` on Windows.
- `locate.rs`: finds git (settings override → PATH → common Windows install dirs).
- `status.rs` (porcelain v2 `-z` parser), `diff.rs` (unified diff parser + hunk
  extraction), `log.rs`, `refs.rs` (branches, remotes, stashes parsers), `repo.rs`
  (`Repo`: status, staging, commits, branches, remotes, sync), `everyday.rs` (amend/undo,
  tags, partial discard), `explore.rs` (blame, compare, image previews), `rewrite.rs`
  (conflict blocks, interactive rebase, reset, backups), `eol.rs` (line-ending guard),
  `pulls.rs` (checking out GitHub pull requests), `assist.rs` (diffs and commit lists sent to AI),
  `reflog.rs` (Recover: HEAD reflog with lost commits marked),
  `signing.rs` (signing config, allowed signers, signature status), `lfs.rs` (Git LFS),
  `submodules.rs`, `worktrees.rs`,
  `validate.rs` (input validation), `errors.rs` (stderr → `ErrorKind` classification),
  `redact.rs` (strips credentials from URLs/output before anything reaches the UI).
- Commands take a `repo_id`, never a path. The backend resolves the path from the
  registry, so the frontend cannot point git at arbitrary directories. File paths are
  validated as relative, no `..`, and always passed after `--`.
- Mutating operations on one repo are serialized by a per-repo async mutex (`state.rs`).

### Persistence
- `db.rs`: SQLite at `<app_data_dir>/gitpilot.db`. Table `repos`. Recents = `last_opened_at`.
  Nothing that Git can answer reliably is stored.
- `settings.rs`: `<app_config_dir>/settings.json`, typed `Settings` struct with serde defaults
  (missing/unknown fields tolerated).
- `secrets.rs`: AI API keys and the GitHub token in the OS keychain (Secret Service on Linux,
  Credential Manager on Windows). Never in settings.json. Env var fallback (read-only):
  `GITPILOT_AI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Claude Code
  uses its own sign-in); GitHub: `GITPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.

### AI (`ai.rs`)
Provider enum: `OpenRouter` (default; `/chat/completions`, `/models`, `/key`), `ClaudeCode`
(runs the user's signed-in Claude Code CLI headless — see `claude_code::print`), `Anthropic`
(Messages API) and `OpenAiCompatible` (OpenAI, local servers like Ollama/LM Studio that speak
`/v1/chat/completions`). Every feature goes through `ai::complete` (one system + user prompt).
Features: commit messages (staged diff only), explain a commit or one file's changes, pull
request title/description (branch commits + diff since the base), conflict suggestions (the
conflict blocks with a few lines of context). Files matching sensitive patterns (`.env*`,
keys, certs) are excluded and input is size-capped. Replies are parsed strictly; failures
return errors — never fabricated output. AI is off by default and needs the privacy
acknowledgement (`ai_ctx` in `commands/assist.rs`).

### GitHub (`github.rs`, `git/pulls.rs`, `features/github`)
github.com only, via api.github.com (REST + one GraphQL query for pull requests with checks and
review state). Sign-in: OAuth device flow (client ID from Settings → GitHub, else built in with
`GITPILOT_GITHUB_CLIENT_ID` at compile time; the device code stays in the backend) or a personal
access token checked with `/user` before it is stored. Git operations never use this token:
clone/fetch/push keep using the user's credential helper or SSH. Pull request checkout: same-repo
PRs become their tracking branch; fork PRs are fetched from `refs/pull/<n>/head` into `pr-<n>`;
existing branches are only fast-forwarded (`update-ref` with the old value).

### Coding assistants (`cli.rs`, `claude_code.rs`, `opencode.rs`)
`settings.assistantTool` picks Claude Code or OpenCode for the Assistant (`assistant_launch`).
Each tool is found from its settings path, then PATH, then known per-OS install locations
(`cli::locate`). Launch = a terminal in the repo directory running the tool (`claude [prompt]`,
`opencode --prompt <prompt>`; the prompt is one argv entry, never a shell). Linux tries the
configured terminal, `$TERMINAL`, then common emulators; Windows opens a new console.
Claude Code is also an AI provider (`claude_code::print`); OpenCode isn't.

### Type-safe IPC
Rust structs derive `ts_rs::TS`; `cargo test` exports TypeScript definitions to
`src/bindings/` (env `TS_RS_EXPORT_DIR` is set in `src-tauri/.cargo/config.toml`).
`src/lib/api.ts` wraps every `invoke` with typed signatures using those bindings.
**After changing a serialized Rust type, run `cargo test` and commit the regenerated bindings.**

### Errors
Every command returns `Result<T, AppError>`. `AppError` serializes as
`{ kind, message, detail }`: `kind` is a stable machine code (`gitNotFound`, `missingIdentity`,
`authFailed`, `pushRejected`, `conflict`, `locked`, …), `message` is a plain-language sentence,
`detail` is redacted raw stderr for the "Technical details" disclosure. UI shows
`message`, never only raw output.

## Project structure

```
src/                     React app
  bindings/              generated TS types (ts-rs) — do not edit by hand
  lib/                   api.ts (invoke wrappers), errors, format helpers, hooks
  store/                 app-level state (React context)
  components/ui/         design-system primitives (Button, Dialog, Menu, Tooltip, …)
  components/layout/     Sidebar, RepoToolbar, Toaster
  features/<area>/       onboarding, repositories, overview, changes, diff, compare,
                         history, branches, remotes, sync, assistant, settings,
                         updates, palette
  styles/                tokens.css (design tokens, light/dark), base.css
src-tauri/
  src/commands/          #[tauri::command] fns grouped by area
  src/git/               git layer (see above)
  tests/                 integration tests on temporary repositories
  capabilities/          Tauri permission set (kept minimal)
```

## Development commands

Verified in session 1 on Ubuntu 24.04 (Node 22.22, Rust 1.97, git 2.43) unless marked *(unverified)*.

```bash
npm install                        # install JS deps
npm run tauri dev                  # run the desktop app with hot reload (not run headless; equivalent build verified)
npm run dev                        # Vite only (UI without backend — invoke() will fail)
npm run typecheck                  # tsc --noEmit
npm run lint                       # eslint
npm test                           # vitest (frontend unit/component tests)
npm run build                      # typecheck + production frontend build
cd src-tauri && cargo fmt --check  # Rust formatting
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test         # unit + integration tests (needs git on PATH); regenerates bindings
npm run tauri build                # release build + bundles for the current OS
npm run tauri build -- --bundles appimage,deb   # Linux packages
npm run tauri build -- --bundles nsis,msi       # Windows installers — must run on Windows (unverified)
npm run tauri build -- --debug --no-bundle      # debug binary with embedded frontend (used for QA)
```

Linux build deps (Debian/Ubuntu): `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev
libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev build-essential file`.

## Coding conventions

- TypeScript: `strict`, `noUncheckedIndexedAccess`, no `any`. Components are function
  components, one per file, PascalCase file names. Feature code lives in `features/<area>`.
  Shared primitives in `components/ui` only.
- Never call `invoke` directly from components — go through `lib/api.ts`.
- Rust: `cargo fmt`, clippy clean with `-D warnings`. Commands are `snake_case`
  verbs grouped by area (`repo_add`, `status_get`, `stage_paths`, `branch_create`, …).
  Command fns stay thin; logic lives in `git/`, `db.rs`, etc. and is unit-tested there.
- Security: no shell invocation; validate every frontend input in Rust; redact URLs
  and output; never log secrets; Tauri capabilities stay minimal (dialog open,
  clipboard write-text, opener for https URLs only).
- Destructive operations require an explicit confirmation dialog that names the
  consequence; the backend command also requires an explicit flag (e.g. `force: true`).
  No force-push without `--force-with-lease` and a second confirmation. No auto-stash.
- Styling: Tailwind utilities backed by CSS variables in `styles/tokens.css`. Use semantic
  tokens (`bg-surface`, `text-muted`, `text-added`, …), never raw hex in components.
  Radius: 4px controls, 6px overlays. No gradients, no decorative shadows (overlays only).
  Status is always icon/letter + color, never color alone. Sentence case for all copy.
- Tests: Git logic is tested against real temporary repositories (`tempfile`), never
  against the developer's repos. Frontend tests use vitest + Testing Library with
  `lib/api` mocked at the module boundary.

## Current implementation state

See `DEVELOPMENT.md` → "Feature tracker", "Current implementation details" and "Known issues" for
the authoritative status. In short (0.5.0): all core features are implemented and verified on Linux,
and on Windows by the user (up to 0.4.0); AI: Claude Code provider verified live, the others not.
0.4.2 (GitHub, AI help), 0.4.5 (windows, worktrees, submodules, LFS, signing, OpenCode) and 0.5.0
(Arch in-app updates, PR review, issues, GitHub over HTTPS, Recover, content search, auto-fetch,
editors/merge tool, tips, large-repo speed, accessibility) are unit/integration-tested; see
DEVELOPMENT.md for what still needs a real run.

Environment notes: `cargo test`/`cargo clippy` rebuild `target/debug/gitpilot` in dev-server mode (it
loads http://localhost:1420), so for manual runs use `npm run tauri dev` or a `tauri build` output.

Key decisions:
- Repo ids instead of paths across IPC (security boundary).
- Hunk- and line-level partial staging with `git apply --cached [--recount]` on patches the
  backend regenerates itself, byte-exact (frontend sends the hunk header + selected line indices).
- Network git (clone/fetch/push) runs in its own process group so cancellation stops helpers too.
- `GIT_EDITOR=:` for every git call: GitPilot never opens an editor.
- Updates: `tauri-plugin-updater`, endpoint `releases/latest/download/latest.json`, minisign public key in
  `tauri.conf.json`. `createUpdaterArtifacts` is false in the config and switched on by CI only when
  `TAURI_SIGNING_PRIVATE_KEY` exists. `scripts/make-latest-json.mjs` builds the manifest. The Arch package
  writes `/usr/share/gitpilot/package-manager` so the app defers to pacman (`src-tauri/src/updates.rs`).
  The app version shown in the UI comes from `package_info()` (same value the updater compares).
- Windows installer art lives in `packaging/windows/` (regenerate with `art-src/make-art.sh`).
- Dialogs: use `autoFocus` on the intended control; `Dialog` moves focus there after `showModal()`.
- Discarding untracked files moves them to the OS trash; discarding tracked changes first
  copies the current file to `<app_data_dir>/discard-backups/<timestamp>/`.
- Pull defaults to `--ff-only`; merge/rebase are explicit settings.
- Accent colour: `settings.accent` (preset id or hex). `src/lib/accent.ts` writes accent tokens as inline CSS variables on `<html>`; "blue" writes none so `tokens.css` stays authoritative. Never hard-code accent hex in components.
- Line-ending guard (`git/eol.rs`): flags staged CRLF in LF repositories before commit; fixes by rewriting the index blob (`hash-object --no-filters` + `update-index --cacheinfo`) and the backed-up working file. `.gitattributes` rules are prepended, never appended.
- AI providers: OpenRouter (default), Claude Code (user's Claude account via `claude -p`, no tools, empty temp cwd, input on stdin), Anthropic, OpenAI-compatible. `Settings::migrate()` + `settings_version` upgrade old settings files.
- Fetch freshness comes from `FETCH_HEAD` mtime, not stored state.
- External links: always `openLink()` from `src/lib/links.ts` (never `openUrl` directly). The opener capability is scoped to `https://*`; a URL outside the scope fails and shows a Copy link toast.
- History rewriting (`git/rewrite.rs`): every reset / commit edit first saves a backup ref under `refs/gitpilot/backups/<ms>-<branch>` (uncommitted tracked changes under `refs/gitpilot/wip/`, labels under `refs/gitpilot/labels/`). Restore backs up the current state first. Interactive rebase runs from a generated todo (`build_todo`), never an editor.
- AI conflict suggestions are applied with `conflict_apply_text`, which replaces a block only if
  it still matches the text the AI saw (`rewrite::replace_block_text`).
- Settings sections can be opened directly: `openSettings("ai" | "github" | …)` in the store.
- Multiple windows: the main window is `main`; a repository window is `repo-<id>` and reads its
  repository from the label (`lib/windows.ts`), not the URL. Only the main window remembers the
  last repository and checks for updates at startup. `settings_save` emits `settings-changed` to
  all windows. Watches are recorded per window (`AppState::note_watch`) and released when a
  window is destroyed. Clone cancellation keys are `clone:<label>`.
- Commit signing writes `commit.gpgsign`, `tag.gpgsign`, `gpg.format`, `user.signingkey` in the
  chosen scope; SSH keys are added to `<app_data_dir>/allowed_signers`, set as
  `gpg.ssh.allowedSignersFile` only when the user has none. Signature status is computed per
  commit in the details pane, not for the log.
- LFS detection reads `.gitattributes` itself, so it works without git-lfs installed.
- CI: no checks on push or PRs (the user tests by hand). `build-installers.yml` (tags `v*` and
  manual runs) runs the checks before building: the Linux job runs typecheck, lint, vitest and
  `cargo test`; the Windows job's `cargo test` must pass before its installers are built.
- Lint: `no-restricted-globals` forbids `status`/`name`/`event` (browser globals that look like
  variables).
- Arch updates (0.5.0): CI signs the `.pkg.tar.zst` and `latest.json` lists it as `linux-x86_64-pacman`.
  When the package-manager marker says pacman, the frontend checks with that target and calls
  `update_install_pacman`, which downloads (signature checked by the updater plugin) and runs
  `pkexec pacman -U --noconfirm --needed`. Never the updater's own installer (it would use dpkg).
- GitHub over HTTPS (0.5.0): `settings.github.useForHttps` (default on) makes `AppState::git()` attach
  the token as `http.https://github.com/.extraHeader` via `GIT_CONFIG_COUNT/KEY/VALUE` env vars
  (`Git::with_github_token`). The token is cached in `AppState` and forgotten on sign-in/out.
  `redact.rs` strips `Authorization:` values.
- Background git (auto-fetch): `Git::non_interactive()` clears askpass helpers and sets
  `GCM_INTERACTIVE=never`, `SSH_ASKPASS_REQUIRE=never`, `credential.interactive=false`;
  `sync_fetch(quiet: true)` gives up if the repo lock is held.
- Force-deleting a branch first saves its tip with `backup_at` ("deleted branch <name>").
- Tooltips: `TitleTooltips` (mounted once in App) shows every `title` attribute in the app's style;
  prefer plain `title` over wrapping in `Tooltip` for simple hints.
- The changed-file list is an ARIA grid (rows, rowgroups, gridcells), virtualized above 300 files.
  Component tests call `expectNoAxeViolations()` (`src/test/axe.ts`) for new views.
- Update notes: `latest.json` gets plain text (`scripts/notes.mjs`) because older versions display it raw; `ReleaseNotes` renders both plain and Markdown.

## Session continuity rules

1. Read `CLAUDE.md` before making substantial changes.
2. Read `DEVELOPMENT.md` for the latest status.
3. Inspect `git status` and the relevant source files.
4. Verify the documented state matches the code.
5. Continue from the actual current state, not assumptions.
6. Preserve existing working functionality.
7. Update both documentation files when significant implementation changes occur.
8. Never claim a feature is complete unless it is actually implemented.
9. Never claim a test passed unless it was run and passed.
10. Record unresolved issues and the exact next step before ending a substantial session.

Update these files incrementally; do not rewrite them from scratch.
