# DEVELOPMENT.md — GitPilot living tracker

## Current status

- **Phase:** 6 — reliability and refinement (implemented on Linux and Windows; Windows verified by the user)
- **Overall:** core Git workflow, branches, remotes, sync, AI provider integration, Claude Code integration and settings are implemented and verified on Linux against real repositories. Linux packages (deb, AppImage) build and launch.
- **Current working area:** 0.4.5 (Batch E) — implemented on branch `release/0.4.5` (session 10), not pushed or released yet
- **Most recently completed:** v0.4.5 (session 10, not released) — multiple windows, worktrees, submodules, Git LFS, commit signing + Verified, OpenCode in the Assistant; checks gate the installer builds. Before that: v0.4.2 (session 9, released as `v0.4.2`) — GitHub sign-in, clone from your repository list, pull requests (list with checks, create, check out), AI explain, AI pull request descriptions, AI conflict help. Before that: v0.4.0 — Batches A–C: everyday Git (amend, undo, tags, stash selected files, discard hunks/lines, auto-refresh), understanding code (blame, commit graph, compare any refs, image previews), conflicts and history (conflict resolver, edit commits, reset with backups) (session 8). Before that: v0.3.1 — readable update notes, Add to .gitignore (session 7)
- **Windows:** verified by the user on a real Windows machine (2026-10-21, all features working); this environment still can't build for Windows
- **Immediate next task:** the user reviews branch `release/0.4.5`, pushes it so the new CI runs on Windows, checks multiple windows in the real app, and decides whether to merge, tag and release. No further batch is planned yet.

## Feature tracker

Legend: [x] implemented & verified · [~] implemented, not fully verified · [-] partial · [ ] not started

- [x] Project foundation and desktop shell (Tauri 2, React 19, strict TS, Tailwind 4)
- [x] Initial setup and onboarding (open / clone / create; non-repo folder → explicit init offer)
- [x] Repository registration (SQLite; moved/deleted folders detected, relocate, remove without touching files)
- [x] Repository dashboard (Overview)
- [x] Git status integration (porcelain v2, renames, conflicts, unborn, detached, merge/rebase state)
- [x] Changed-file browser (groups, filter, multi-select, keyboard, context menu)
- [x] Diff viewer (unified/split, highlighting, virtualization, binary/empty/rename/mode/CRLF/conflict views)
- [x] Staging and unstaging (files, all, hunks, and **individual lines** via `git apply --cached --recount`)
- [x] Commit creation (multiline via stdin, identity check, hooks/signing errors surfaced, never auto-stages)
- [x] Commit history (paging, search, file history, details, per-file diffs, copy)
- [x] Branch management (create/switch/rename/delete with merged check, remote checkout, compare, upstream, stashes)
- [x] Remote management (add/edit/remove, credential redaction, `ext::` blocked)
- [x] Fetch, pull, and push (progress, ff-only default, publish, rejection explained, guarded force-with-lease; fetch/push/clone cancellable)
- [x] Merge, rebase, cherry-pick, revert with continue/skip/abort
- [x] Amend, undo last commit, tags, stash selected files, discard hunks/lines, auto-refresh (0.4.0)
- [x] Blame, commit graph, compare any refs, image previews (0.4.0)
- [x] Conflict resolver, edit commits (interactive rebase), reset with backups + restore (0.4.0)
- [~] AI commit message generation (OpenRouter default, Claude Code account, Anthropic, OpenAI-compatible). **Claude Code provider verified live in the real app.** OpenRouter/Anthropic/OpenAI request shapes unit-tested only (openrouter.ai unreachable from the build sandbox)
- [~] AI explain (commit, one file's changes), AI pull request description, AI conflict help (0.4.2): prompts/parsers unit-tested, inputs integration-tested, UI checked with a mocked backend; no live provider call yet
- [~] GitHub (0.4.2): sign-in (device flow + token), clone from your repository list, pull requests (list with checks/review, create, check out incl. forks). Parsers unit-tested, PR checkout integration-tested on a local remote and live against github.com (public fork PR), UI checked with a mocked backend; **not yet used with a real signed-in account**
- [x] Accent colours (11 presets + custom; OKLCH-derived tokens; contrast unit-tested for every preset in both themes)
- [x] .gitignore support (Add to .gitignore dialog; tracked-but-ignored files flagged with Stop tracking; integration-tested and verified in the real app)
- [x] Line-ending guard (CRLF into LF repos; detection + fix + .gitattributes; integration-tested and verified in the real app)
- [x] Claude Code integration (detection verified with real CLI 2.1.304; terminal launch verified with xterm + stand-in executable; prompt passed as one argv entry)
- [x] Application settings (persisted JSON, validated; keychain for keys with env fallback)
- [x] Error handling and safety (classified errors, plain messages + technical details, confirmations + backend flags)
- [x] Automated tests (Rust 163 unit + 27 integration on temp repos, plus 1 opt-in live GitHub test; frontend 101 vitest — end of session 10). CI runs them only when installers are built (tags and manual runs); the Windows job stops if its tests fail
- [~] UI polish and visual QA (all main screens inspected on Linux/Xvfb, light + dark, min size; no screen-reader testing)
- [x] Windows packaging (MSI + NSIS built by `.github/workflows/build-installers.yml` on windows-latest; installed and used by the user)
- [x] Linux packaging (deb 5.1 MB and AppImage 80 MB built; AppImage launched; Arch/CachyOS `gitpilot-bin` package built with makepkg from `packaging/arch/PKGBUILD` — not yet installed on a real Arch system)
- [x] In-app updates (verified end to end for AppImage; Windows/.deb unverified)
- [~] Multiple windows (0.4.5): implemented, store/label logic unit-tested, **not yet run in the real app** (needs a desktop session)
- [x] Worktrees (0.4.5): add/list/remove/prune integration-tested, UI checked with a mocked backend
- [x] Submodules (0.4.5): list/update integration-tested with a real local submodule, UI checked with a mocked backend
- [~] Git LFS (0.4.5): detection integration-tested without git-lfs; track/untrack runs only where git-lfs is installed (CI runners), not on this machine
- [x] Commit signing (0.4.5): SSH signing + Verified integration-tested with a throwaway key; GPG key listing unit-tested, GPG signing not exercised
- [x] OpenCode in the Assistant (0.4.5): detection and `--prompt` checked against the installed OpenCode 1.18.31; terminal launch not run on the desktop
- [~] Documentation and release preparation (README, CLAUDE.md, INSTALL.md, CHANGELOG, this file; CI builds installers and releases on tags; update packages are signed, installers are not — no code-signing certificate)

## Work log

### Session 10 — 2026-10-25 (v0.4.5, branch `release/0.4.5`, not pushed)
- User asked for release notes for 0.4.2 (given in chat), added "OpenCode for the Assistant" to the 0.4.5 roadmap (user committed it, 18505df), then asked for a 0.4.5 plan; plan approved with: windows opt-in ("Open in new window", focus if open), OpenCode in a renamed Settings → Coding assistant tab, signing for SSH + GPG with global or repository scope.
- Commits: CI (e40462c), OpenCode (f2694b7), signing (0fbd934), flaky picker test fix (a77efed), LFS (1bb3e04), submodules (ee2ecb3), worktrees (ba3b877), windows (8ac6229), test timeouts for slow machines (29bdc91), release (210572f).
- Found and fixed along the way: the Assistant probed Claude Code before settings loaded; `rel_paths` rejects an empty list (submodule "update all"); local-path submodules fail with "transport 'file' not allowed" → plain message; git lists worktrees by path, not creation order (test fix); a component used `status` without taking it from the store, which silently read `window.status` → new `no-restricted-globals` lint rule; a frontend test raced the mocked repository list.
- One commit (0fbd934) went in while a flaky frontend test had failed in that run (the check command didn't stop on it); fixed in a77efed and a strict check script was used for every later commit.
- Visual QA (mocked backend + headless Chromium, as in session 9): Coding assistant settings, Assistant with OpenCode (dark), Commit signing settings, Verified badge, Overview LFS row, LFS-missing banner, Submodules, Worktrees list and dialog.
- Deviation from the plan: no "Open in new window" in the sidebar's repository switcher (one menu item can't have two actions); it's in Repositories, the palette, worktrees and submodules.
- Running three vitest suites at once made several tests (old and new) time out at Testing Library's 1 s wait; waits are now 4 s and tests 20 s, and all pass in three parallel runs (29bdc91).
- After the user found per-push CI too slow: `ci.yml` removed and the Windows tests in `build-installers.yml` made blocking; `release/0.4.5` fast-forwarded into `main` locally (not pushed; commits from then on without the Claude co-author line, at the user's request).
- Checks at the end: strict check script (tsc, eslint, vitest 101, cargo fmt, clippy -D warnings, cargo test 163 + 27 + 1 ignored), release `.deb` build, `makepkg`.

### Session 9 — 2026-10-25 (v0.4.2, released as `v0.4.2`)
- User confirmed 0.4.0 is complete and asked to start 0.4.2, fix the documentation mismatches, work on a new branch, commit as much as possible and not push. First session on the user's own CachyOS machine (Node 26.11, Rust/cargo 1.98, git 2.56); `npm ci` was needed (fresh checkout). Baseline before changes: Rust 102 + 21, vitest 65, all checks pass.
- **Docs** (c7e563e): DEVELOPMENT/CLAUDE/README/INSTALL brought in line with 0.4.0 (stale "most recent", duplicated tracker and README lines, "no file watcher", "no CI", non-existent `ops.rs`/`branches.rs`/`remotes.rs`, Windows "not yet built", version-specific file names).
- **AI** (e8ad89e): `ai::complete` shared by every feature; `explain`, `pr_description`, `conflict_help` with strict JSON parsing; `rewrite.rs` now has one conflict scanner (`scan_conflicts`) behind `resolve_block`, `conflict_blocks` and `replace_block_text`; `git/assist.rs` builds the inputs. Commands `ai_explain` (tagged `ExplainTarget`), `ai_pr_description`, `ai_conflict_help`, `conflict_apply_text`. UI: `ExplainDialog`, `AiNote`/`AiError`, `ConflictHelpDialog` (editable suggestions, applied one at a time, later conflicts renumbered). Store gained `settingsTab`/`openSettings`.
- **GitHub backend** (4a3fa8d): `github.rs`, `git/pulls.rs`, `commands/github.rs`, keychain slots in `secrets.rs`, `settings.github.clientId`, error kinds `githubNotSignedIn`/`githubFailed`. **UI** (ec1b478): Settings → GitHub, `SignInDialog`, `GitHubAccountCard`, clone picker, Pull requests section (Ctrl+7), `CreatePullRequestDialog`.
- Bug found by probing the real endpoint: an unknown client ID makes `/login/device/code` return a bare 404, which read as "couldn't find that repository" → sign-in errors now name the client ID (2ce82cd). Live (opt-in) test checks out octocat/Hello-World#1, a fork PR, over HTTPS: passes.
- Visual QA without Xvfb/xdotool (not installed): Vite with a mocked `__TAURI_INTERNALS__.invoke` and Playwright's cached headless Chromium driven over CDP (scripts kept in the session scratchpad, not in the repo). Checked light/dark and 900×580: Pull requests list, create dialog with AI text, unpushed-branch notice, Settings → GitHub, sign-in code and token views, clone picker (SSH pick fills URL and folder), Explain, conflict help. Found raw backticks in conflict help → rendered as markup (5bbb5f6).
- "Write with AI" with a base branch that isn't fetched now says to fetch first (11db40a).
- CI passes an optional `GITPILOT_GITHUB_CLIENT_ID` repository variable to the builds.
- Release: version 0.4.2 in package.json, Cargo.toml, tauri.conf.json, PKGBUILD (checksum of the local release .deb; `makepkg` built `gitpilot-bin-0.4.2-1` from it).
- Checks at the end: cargo fmt, clippy -D warnings, cargo test 132 unit + 23 integration (+1 ignored live), tsc, eslint, vitest 82, `npm run build`, release `.deb` build (5.8 MB). The release binary wasn't launched (no Xvfb here; it would open on the user's desktop).

### Session 8 — 2026-10-21 (v0.4.0)
- User asked for the whole feature list; split into batches. A–C ship as **0.4.0**; D is planned for **0.4.2** and E for **0.4.5** (see Roadmap); nothing started until the user says 0.4.0 is complete.
- **Batch A** (commit cb0e149): amend (pushed-commit confirmation), undo last commit (soft reset, message back in composer), auto-refresh file watcher skipping ignored paths (setting `autoRefresh`), tags (lightweight/annotated, push, delete local/remote), stash selected files, discard hunk/lines with backup.
- **Batch B** (d1dd026): blame, commit graph (lane layout as a pure tested function; history in date order), file-by-file compare of any refs (three-dot or direct), image before/after previews, dialogs rendered at document top (nested dialogs + Escape).
- **Batch C** (2aed89f): `git/rewrite.rs` — per-block conflict resolution and whole-file sides, interactive rebase from a step list (todo built by `build_todo`, messages via files), `reset_to` soft/mixed/hard, backups under `refs/gitpilot/backups/<ms>-<branch>` (+ `refs/gitpilot/wip/*` for uncommitted tracked changes, `refs/gitpilot/labels/*`), restore backs up current state first. UI: Keep mine/theirs/both in the diff, EditCommitsDialog, ResetDialog, Branches → Backups.
- Verified in the real app (Xvfb) across A–C: discard hunk/lines, undo, amend, tag push, stash file, blame → History, compare, merge conflict resolved per block → commit merge, hard reset + backup, edit commits (remove/combine/reword), restore from backup.
- The session hit its usage limit after Batch C's QA and before its commit; C was committed in the next session after re-running all checks.
- Checks: cargo fmt, clippy -D warnings, cargo test 102 unit + 21 integration, tsc, eslint, vitest 65 — pass.

### Session 7 — 2026-10-21 (v0.3.1)
- User reports: update window showed release notes as raw Markdown; git-ignored files appeared in Changes; no way to ignore files; About buttons did nothing.
- **Links:** capability had `opener:allow-open-url` with no URL scope, so every `openUrl` was rejected (and `void openUrl(...)` hid it) since 0.1.0. Now `{"identifier":"opener:allow-open-url","allow":[{"url":"https://*"}]}`; all calls go through `lib/links.ts::openLink`, which dispatches `gitpilot:link-failed` → store toast with Copy link. Verified in the real app with a logging stand-in `xdg-open`: 0.3.1 opens all three About links; the 0.3.0 AppImage opened none (bug reproduced). Vitest asserts the capability scope.
- **Update notes:** `components/ui/ReleaseNotes.tsx` renders a Markdown subset (headings, bullets, **bold**, `code`, links, tables) and the plain form ("Title" line + "•" bullets, bold lead sentence) as React elements — no HTML injection. `scripts/notes.mjs::plainNotes` converts the CHANGELOG section for `latest.json`, because the dialog that shows notes belongs to the *old* version (0.3.0 and earlier show plain text).
- **Ignored files:** the files the user saw were tracked before the rule existed (status already respected .gitignore). `FileEntry.ignored` from `ls-files -c -i --exclude-standard`; badge + Changes notice with Stop tracking (`git rm --cached -r`, confirmed). `Repo::ignore_add` appends deduplicated single-line patterns to the root .gitignore. `IgnoreDialog`: this file (`/path`, escaped), all `*.ext`, folder, custom; offers stop-tracking for tracked selections. Commands `gitignore_add`, `untrack_paths`.
- Bug found in real-app QA: ignoring with nothing to untrack failed ("No files were selected") → empty check moved before validation; regression assertion added.
- File rows no longer set a native `title` (GTK tooltips covered the context menu); renames keep it.
- Checks: cargo fmt, clippy, cargo test 84 + 18, tsc, eslint, vitest 55 — pass. Real app: ignored badge + notice; right-click → Add to .gitignore → *.log; Stop tracking → staged deletions, files kept on disk. Update notes rendering checked with the app CSS, not inside a real update.

### Session 6 — 2026-10-21 (v0.3.0)
- Objective (user): keep classic blue but allow changing the app colour; stop GitHub PRs showing "context doesn't match" (user confirmed it happens on GitHub's PR page → line endings); rearrange settings; OpenRouter as default AI with the user's key; Claude Code with the user's own Claude account.
- **Accent:** `settings.accent` (preset id or `#rrggbb`, validated in Rust). `src/lib/accent.ts` derives `--accent*`, `--on-accent`, `--focus`, `--selection` per theme in OKLCH (gamut-clamped); "blue" removes overrides so `tokens.css` stays the source of truth. Applied in the store's theme effect. Tailwind gained `--color-focus`. Toned down dark `--selection` chroma after QA (green looked loud).
- **Line endings:** `src-tauri/src/git/eol.rs`. Staged A/M files (`--no-renames`), skip `-text`/binary/`eol=crlf` via `check-attr`, repo convention from `ls-files --eol` (excluding staged files). Flags: HEAD LF → staged CRLF (`lineEndingsOnly` if identical after normalization, else `crlfIntroduced`); new CRLF file in an LF repo. HEAD already CRLF → not flagged. Fix: normalized blob via `hash-object -w --no-filters`, `update-index --cacheinfo`, working file backed up to discard-backups then rewritten. `.gitattributes`: `* text=auto` **prepended** (later lines win; appending would override `*.png binary`). UI: `features/changes/LineEndingNotice.tsx` in the composer; setting `checkLineEndings` (Git → Committing).
- **AI providers:** `AiProviderKind` gains `openRouter` (new default, model `openrouter/auto`) and `claudeCode`. `Settings.settings_version` + `migrate()` moves untouched old defaults (Anthropic, never enabled/acknowledged) to OpenRouter. OpenRouter: `/chat/completions` with `HTTP-Referer`/`X-Title`, `/models` (text-output models, prices per million, free flag), `/key` (usage/limit). Keychain account `ai-openrouter`, env `OPENROUTER_API_KEY`.
- **Claude Code account:** `claude_code::print` runs `claude -p <instruction> --output-format json --tools "" --no-session-persistence --strict-mcp-config --disable-slash-commands [--model m]` in an empty temp dir, rules + diff on stdin (so no newlines in argv — matters for `.cmd` shims on Windows); retries with only essential flags on "unknown option". Login/usage-limit errors mapped to plain messages. `auth_status` parses `claude auth status --json`; `claude_login` opens `claude auth login` in a terminal; Settings re-checks on window focus.
- **Settings:** split into `features/settings/{SettingsView,parts,AppearancePane,AiPane,ClaudeAccount}.tsx`; sections General / Appearance / Git / AI / Claude Code / Updates / About, icons, keyword search.
- Checks: cargo fmt, clippy -D warnings, cargo test 84 unit + 17 integration, tsc, eslint, vitest 42 — all pass.
- Verified in the real app (Xvfb, release build): migration to OpenRouter; green accent across app; CRLF warning on a CRLF-only file + new CRLF file (README untouched) → Convert to LF → only-EOL file disappeared, new file LF, backup written; Claude Code provider produced 3 suggestions ("Claude Code · haiku") with the real CLI; Claude Code pane shows signed-in status.
- Not verified: live OpenRouter calls and model list (openrouter.ai blocked by the sandbox allowlist); "Sign in with Claude" terminal flow on a desktop; Windows behaviour of the new code; OS keychain (no Secret Service in the sandbox).

### Session 1 — 2026-10-20

**Objective:** inspect the environment, establish architecture, build the application end to end.

**Inspected:** working directory was empty (only dotfiles). Ubuntu 24.04, Node 22.22, npm 10.9, Rust 1.97, git 2.43, root access. WebKitGTK dev libraries were missing → installed. Latest Tauri on crates.io is 3.0 alpha; pinned **Tauri 2** per spec.

**Implemented (files):**
- Backend `src-tauri/src/`: `error.rs`, `git/{runner,locate,errors,redact,validate,status,diff,log,refs,repo}.rs`, `db.rs`, `settings.rs`, `secrets.rs`, `ai.rs`, `claude_code.rs`, `state.rs`, `commands/*.rs`, `lib.rs`. Integration tests `tests/git_workflow.rs`.
- Frontend `src/`: design tokens (`styles/`), UI primitives (`components/ui/`), layout (`Sidebar`, `RepoToolbar`, `Toaster`), store (`store/AppStore.tsx`), typed API (`lib/api.ts`), features (onboarding, overview, changes, diff, history, branches, remotes, assistant, settings, repositories, palette). Tests in `*.test.ts(x)`.
- Docs: `README.md`, `CLAUDE.md`, this file.

**Bugs found and fixed during the session:**
- Diff unit-test fixture lost context lines (Rust `\` line continuation strips leading spaces) → rewrote with `concat!`.
- Clippy `field_reassign_with_default` in a settings test.
- Syntax highlighting never visible: `.hl` scope class missing on the diff container.
- Side-by-side diff overflowed (both halves shared one wide scroll width) → split mode now wraps lines with measured row heights.
- Stale measured heights after switching split → unified (gaps) → `virt.measure()` on layout change.
- Hunk header wrapped / "Stage hunk" overlapped section text at narrow widths → header contents pinned to viewport width.
- Settings: segmented controls stretched full width; switch knob escaped its track (missing `left-0`).
- Toolbar made Push primary while the branch was behind → Pull is primary when behind.
- Destructive dialogs auto-focused the close button → Cancel is focused.
- Commit-composer test raced the store's repo opening.

**Checks run (final results):**

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass |
| ESLint | `npm run lint` | pass (0 warnings) |
| Frontend tests | `npm test` | 24/24 pass (6 files) |
| Rust format | `cargo fmt --check` | pass |
| Clippy | `cargo clippy --all-targets -- -D warnings` | pass |
| Rust tests | `cargo test` | 64 unit + 9 integration pass |
| Frontend build | `npm run build` | pass (JS 544 kB / 169 kB gzip) |
| Release + bundles | `npm run tauri build -- --bundles deb,appimage` | pass |
| AppImage launch | ran under Xvfb | launches, restores persisted settings/last repo |
| Windows cross-check | `cargo check --target x86_64-pc-windows-gnu` | **could not run** — target download blocked by network allowlist |

**Manual/visual verification (real app under Xvfb 1440×900, real repos):**
first-run welcome; repositories page incl. missing folder; changes (staged deletion, D/A pair, two-hunk edit, untracked `.env.local`); unified + split diff; staging one hunk via UI then committing with `Ctrl+Enter` (verified with `git log --stat`: only that hunk committed, untracked files untouched); push rejected on diverged branch (plain explanation shown); discard confirmation for an untracked file; branch picker; history with author ≠ committer, merge commit, tag; branches; remotes; overview; assistant; command palette (file + commit search); settings (appearance, AI with keychain unavailable); dark theme; 900×580.

**Important decisions:** see CLAUDE.md "Key decisions". Additionally: AI default model `claude-haiku-5-5` (user-editable); Claude Code launched via terminal emulator on Linux and `CREATE_NEW_CONSOLE` on Windows (no shell, so prompts can't inject commands).

### Session 5 — 2026-10-20 (v0.2.1)
- User hit a dead end in 0.2.0: branch without upstream + remote branch with same name + unrelated history → Push rejected, Pull disabled, and `git pull` refuses unrelated histories.
- Backend: `RepoStatus.remote_twin` (same-named remote branch for an unlinked branch: ahead/behind/unrelated). `pull(default, PullOptions { strategy, allow_unrelated })` pulls from the twin and sets upstream on success or conflict. New `ErrorKind::Diverged` / `UnrelatedHistories`; an ff-only "diverged" with no merge base is reported as unrelated.
- UI: `features/sync/usePull.tsx` (Merge/Rebase choice; Combine histories with acknowledgement), toolbar twin display ("not linked"), Pull enabled for twins, toast actions ("Pull now" on rejected push). Palette uses the same hook.
- Tests: 70 unit + 16 integration (new: unlinked unrelated branch end to end; diverged pull + merge override); vitest 32. Verified in the real app on a reproduction: Push rejected → Pull now → unrelated dialog → Combine → linked → Push → up to date (git log confirmed).

### Session 4 — 2026-10-20 (v0.2.0, same version)
- Objective: nicer Windows installers; update in place instead of uninstall/reinstall.
- Installer art: `packaging/windows/*.bmp` generated by `art-src/make-art.sh` (IBM Plex from the bundled fonts). NSIS sidebar 164×314, header 150×57; WiX dialog 493×312, banner 493×58. Publisher/copyright/homepage set. **Previewed with a mock-up only; not seen in a real Windows installer.**
- Updates: `tauri-plugin-updater` + `tauri-plugin-process`. `UpdateProvider` (startup check ≤1/day, manual check), sidebar `UpdateNotice`, `UpdateDialog` (notes, progress, restart), Settings → General → Updates (`checkForUpdates` setting). `update_support` command reports install kind; Arch package writes `/usr/share/gitpilot/package-manager` = `pacman` so the app defers to pacman.
- Signing key: minisign pair generated in session; public key in `tauri.conf.json`. Private key + password handed to the user out of band (NOT in the repo) for the `TAURI_SIGNING_PRIVATE_KEY*` secrets.
- CI: update artifacts only when the key secret exists; `update-manifest` job builds `latest.json` via `scripts/make-latest-json.mjs`; release job checks tag == version and publishes a full release (pre-releases aren't served by `releases/latest`).
- **End-to-end verified (Linux AppImage):** old 0.2.0 build pointed at a local server offering a signed 0.2.1 → found on startup → Update now → file replaced (checksum = 0.2.1) → Restart → About shows 0.2.1. Run twice; second run also via keyboard only.
- Bugs found: dialog focus stayed on a removed button after install (Enter did nothing) → focus moves to Restart; UI version came from Cargo, not the version the updater compares → now `package_info()`.
- Not verified: Windows in-app update (NSIS/MSI passive install), .deb update via pkexec, real GitHub-hosted latest.json.

### Session 3 — 2026-10-20 (v0.2.0)
- Objective: fix the four limitations from the 0.1.0 release notes.
- **Line staging:** `git/diff.rs::patch_for_lines` builds a single-hunk patch from selected line indices (forward: unselected `+` dropped, unselected `-` → context; reverse/unstage: the mirror). Deletions and additions are paired per change block so partial selections keep natural line order (found by an integration test that produced `a c B d` before the fix). Applied with `git apply --cached --recount`. UI: clickable `+`/`−` markers in `DiffViewer` (unified + split), selection limited to one hunk, Shift-click ranges, "Stage N lines" in the hunk header.
- **Cancellation:** `runner::run_streaming` takes `Option<&Notify>`; network git runs in its own process group (Unix) and cancel sends SIGTERM to the group, waits ≤5 s, then SIGKILL (Windows: `taskkill /T`). Without the process group the ssh helper outlived git — caught by a regression test (verified the test fails without the fix). Registry in `state.rs` (`begin_cancellable`, `op_cancel` command, keys `clone` / `repo:<id>`). Cancelled clone removes the partial folder (or empties a pre-existing empty one). Pull deliberately not cancellable.
- **Integration ops:** `merge`, `rebase` (confirmed), `cherry_pick` / `revert` (merge commits use `-m 1`), `sequence(continue|skip|abort)` (skip/abort confirmed). `GIT_EDITOR=:` so `--continue` never opens an editor. UI: Branches menu (Merge/Rebase), Compare dialog (Cherry-pick on commits only on the other branch), History (Revert), `OperationBanner` in Changes, toolbar shows "Rebase in progress" and blocks push/pull mid-operation. `useIntegrate` treats conflict stops as pauses and jumps to Changes.
- **Signing:** workflow imports a `.pfx` from secrets `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` and passes `certificateThumbprint` via `--config`; unsigned build + warning otherwise. Not exercised (no certificate). `docs/CODE_SIGNING.md` documents providers.
- **Bug found in QA:** dialogs focused the × button on open (showModal default), so Enter closed confirm dialogs and `autoFocus` fields never got focus. Fixed in `Dialog.tsx` (`data-autofocus`), with tests.
- Checks: tsc, eslint, vitest 31/31, cargo fmt, clippy -D warnings, cargo test 66 unit + 14 integration — all pass. Release deb/AppImage/Arch package built.
- UI verified in the real app: paused rebase banner → resolve → Continue (git log confirmed); stage 2 of 3 lines (git diff --cached confirmed); fetch against a hanging ssh helper → Cancel (no git/ssh processes or lock files left); rebase dialog force-push acknowledgement; merge via Enter (merge commit confirmed); revert from History (revert commit confirmed).
- Not verified: clone "Stop cloning" button by hand (backend covered by tests), cherry-pick button by hand (backend covered), Windows build of the new code, signing.

### Session 2 — 2026-10-20
- Objective: Windows MSI and a CachyOS package, with install instructions.
- Windows target still can't be downloaded here (network allowlist), so added `.github/workflows/build-installers.yml`: builds MSI + NSIS on `windows-latest` (Rust tests run but don't block the installer), deb + AppImage + Arch package on `ubuntu-24.04`, and publishes a GitHub Release on `v*` tags. YAML validated locally; workflow not run yet.
- Added `packaging/arch/PKGBUILD` (`gitpilot-bin`, repackages the .deb; pinned sha256). Built `gitpilot-bin-0.1.0-1-x86_64.pkg.tar.zst` with makepkg 6.0.2 on Ubuntu; contents and metadata inspected. Binary needs glibc ≥ 2.39 (CachyOS ships newer).
- Added `INSTALL.md`.
- Next: run the workflow, test the MSI on Windows, and `pacman -U` the package on CachyOS.

## Current implementation details

- **Status refresh:** on window focus, after every operation, manually (F5 / Ctrl+R / toolbar), and when files change on disk (`watch.rs`, setting `autoRefresh`, ignored folders not watched, debounced).
- **Operations:** one at a time per window (`run()` in the store); per-repo async mutex in the backend for mutating commands.
- **Timeouts:** local git 120 s; network 15 min. Fetch/push/clone can be cancelled; pull can't (stopping mid-merge could leave a half-updated tree).
- **File list:** not virtualized (diff is). Thousands of changed files will render slowly.
- **Syntax highlighting:** per line with highlight.js (24 languages); multi-line constructs may be mis-colored.
- **Partial staging:** hunks and lines. Backend regenerates the diff and matches the hunk header byte-exactly; refuses if the hunk changed. Line selections are per hunk.
- **Discard:** tracked → backup copy in `<app_data>/discard-backups/<ms-timestamp>/` then `git restore --worktree`; untracked → OS trash, only after `git ls-files --others` confirms they're untracked.
- **Conflicts:** shown with ours/theirs regions; "Mark as resolved" stages. "Stage everything" deliberately skips conflicted files.
- **Merge/rebase/cherry-pick/revert:** started from the UI or a terminal; Continue/Skip/Abort in the Changes banner. Interactive rebase via Edit commits (0.4.0).
- **AI:** off by default; requires privacy acknowledgement; sensitive file patterns excluded, 48 k char cap; errors never replaced with fabricated output. Inputs: commit messages = staged diff; explain = a commit's diff or one file's changes (untracked files as added); PR description = commit messages (max 100) + diff `base...HEAD`; conflict help = the file's conflict blocks with 8 lines of context (sensitive files refused). Conflict suggestions apply only if the block is unchanged.
- **GitHub:** api.github.com only, 30 s timeout, `X-GitHub-Api-Version: 2022-11-28`. Repository list: up to 10 pages × 100, sorted by last push, filtered client-side. Pull requests: one GraphQL query, 50 most recently updated open PRs. The link to GitHub prefers the current branch's remote, then `origin`, then the first github.com remote; forks show the parent's PRs by default. Creating a PR requires the branch to be pushed with nothing ahead; `head` is `owner:branch` across forks. Device flow: device code kept in `AppState`, waiting is cancellable (`op_cancel("github-login")`), slow_down honoured, network blips retried.
- **Keychain:** Linux Secret Service via `keyring` (sync-secret-service + crypto-rust); in headless/no-DBus environments the UI shows the env-var fallback.
- **Accessibility:** labels on icon buttons, tooltips, roles for lists/menus/dialogs, keyboard navigation, focus rings, non-color status. Not tested with a screen reader.

## Known issues

1. **Windows:** user reported on 2026-10-21 that all features work on Windows (0.3.x installers built by CI). Not tested in this environment (no Windows host); CI still builds installers without running the test suite on Windows.
2. **AI providers other than Claude Code not tested live** — the Claude Code provider was verified in the real app (session 6). Request shapes for OpenRouter, the Anthropic Messages API (`anthropic-version: 2023-06-01`) and OpenAI-compatible `/chat/completions` are written to the documented formats and unit-tested, but no real call was made from this environment.
3. **Real Claude Code session not observed** — with the real CLI in this sandbox the terminal opened and closed immediately (the sandboxed CLI exits); the mechanism was verified with a stand-in executable. Check on a normal desktop.
4. **Detection of a hanging `claude --version`** waits up to 10 s before the Assistant enables its launch button.
5. **Native `title` tooltips** elsewhere (not file rows, fixed in 0.3.1) still render as GTK tooltips.
6. **Sidebar doesn't auto-collapse** at narrow widths (user can collapse it).
7. **No checks on push or PRs (by choice, session 10):** a per-push workflow was tried in 0.4.5 and removed because it took too long; the user tests features by hand. Checks run only in `build-installers.yml` (tags `v*`, manual runs): Linux runs everything before building, and Windows `cargo test` now has to pass before the Windows installers are built. The Rust tests have not passed on Windows in CI yet, so the first Windows build may need fixes.
8. **GitHub features not used with a real account yet** (session 9): no OAuth app client ID exists for GitPilot, so "In the browser" sign-in is hidden unless one is entered in Settings → GitHub or built in (`GITPILOT_GITHUB_CLIENT_ID`, CI repository variable). The token sign-in, repository list, pull request list/create and the AI features were not exercised against the real services from this environment (no token or AI key used). Verified live: public API response shapes, the device-code error for an unknown client ID, and checking out a fork pull request over HTTPS.
9. **Git over HTTPS doesn't use the GitHub sign-in:** cloning a private repository over HTTPS still needs a credential helper (or SSH). Deliberate for now; a possible follow-up is passing the token to git via `GIT_CONFIG_*` environment variables for github.com only.
10. **Multiple windows not run in the real app yet** (session 10): no desktop session was used; window creation, the `repo-*` capability and watch release on close are unverified by hand.
11. **GPG signing not exercised:** key listing is unit-tested from `--with-colons` output; signing a commit with GPG and its Verified status were not run.

## Roadmap (agreed with the user, 2026-10-21)

**0.4.2 — Batch D: GitHub and AI** (implemented in session 9; see Known issues #8 for what still needs a real account)
1. Sign in with GitHub (OAuth device flow; needs the user's OAuth App Client ID, otherwise personal access token fallback; token in the OS keychain).
2. Clone from your GitHub repo list (search).
3. Pull requests: open a PR for the current branch, list open PRs with status/checks, check out a PR locally, open on GitHub.
4. AI: explain a commit or diff.
5. AI: write a PR description from the branch's commits.
6. AI: conflict help (suggested resolution + explanation; user applies it).

**0.4.5 — Batch E: bigger additions** (implemented in session 10; item 7 still needs a real-app check)
7. Multiple windows (a repository per window).
8. Worktrees.
9. Submodules (list, init, update).
10. Git LFS (tracked files, track new types, warn if LFS missing).
11. Commit signing setup (GPG/SSH) + "Verified" mark in History.
12. CI: run the full test suite on Windows and Linux (done as a gate in the installer build; per-push runs dropped at the user's request).
13. Assistant: choose between Claude Code and OpenCode (`opencode` CLI) — detect it, launch it in a terminal in the repository with the selected prompt, and switch in Settings (added at the user's request, 2026-10-25).

**0.5.0** (plan agreed 2026-10-25, extended 2026-10-28; branch `release/0.5.0`)
- Arch/CachyOS in-app updates: signed `.pkg.tar.zst` in `latest.json` (`linux-x86_64-pacman`), installed with `pkexec pacman -U` (added 2026-10-28). Done.
- A1. Windows tests pass (needs a Windows CI run; the user starts it and shares failures).
- A2. Large repo speed: virtualized changed-file list, status caching, perf test.
- B3. GitHub sign-in for Git over HTTPS (github.com only, header via `GIT_CONFIG_*`, on by default when signed in, header redacted). Done.
- B4. Review pull requests in the app (files, conversation, checks, comment/approve/request changes, merge, delete branch, AI explain).
- B5. Issues (list, search, create, Start work → branch, "Fixes #n" in the PR).
- C6. Recover lost work (reflog in plain language, lost commits marked, force-deleted branches backed up, Branches → Recover, History → Show earlier states). Done.
- C7. Auto-fetch (`autoFetchMinutes`) with "new commits" toasts.
- C8. Open in editor / terminal; external merge tool for conflicts.
- C9. Search history by content (`-S`/`-G`), date range, path.
- D10. Beginner tips (`settings.tips`, `dismissedTips`).
- D11. Accessibility pass (axe in tests, keyboard walkthrough, aria-live), sidebar auto-collapse at narrow widths, custom tooltips instead of native `title`.
- E. Release: version bump, docs, changelog, release notes.

## Next-session handoff

**Continue with:** branch `release/0.4.5` is complete and committed but not pushed. Before releasing:
1. Test the features by hand (below). The checks run when you start the installer build (tag `v0.4.5` or "Run workflow"); the Windows job now stops if Windows tests fail, so fix whatever it reports (likely candidates: path separators in tests, `ssh-keygen`/signing on the runner).
2. Real app (`npm run tauri dev`): Repositories → Open in new window; check the window opens on the right repository, settings changes apply to both windows, closing it stops its file watching, and clone/cancel works in each window.
3. OpenCode: Settings → Coding assistant → OpenCode, then Assistant → Open in OpenCode (a terminal opens in the repository with the prompt).
4. Signing with your own key: Settings → Git → Commit signing → choose your SSH key → commit → History shows Verified. GPG if you use it.
5. Install git-lfs and check Overview → Large files (track a type, set up LFS for the repository).
6. Merge to main, tag `v0.4.5`, push the tag. `packaging/arch/PKGBUILD` has the checksum of the local .deb; update it from the release asset if the CI build is released.

0.4.2 items still to try with a real account: GitHub sign-in, repository list, pull requests (list/create/check out), AI explain / PR description / conflict help with a live provider; "In the browser" sign-in needs an OAuth app client ID (Settings → GitHub or the `GITPILOT_GITHUB_CLIENT_ID` repository variable).

Still unverified from earlier releases (each needs a hands-on check by the user or on a machine with network access and a desktop session):
1. OpenRouter end to end: save key → key verified → model list → suggestion. Then Anthropic and an OpenAI-compatible endpoint (e.g. Ollama `http://localhost:11434/v1`).
2. "Sign in with Claude": the terminal opens `claude auth login` and the status flips after returning to GitPilot.
3. In-app updates for the Windows installers and the .deb package (AppImage is verified).
4. Arch package installed with `pacman -U` on a real Arch/CachyOS system.

**QA harness (Linux):** with Xvfb/xdotool (Ubuntu sandbox, sessions 1–8): Xvfb `:99` at 1440×900, `xdotool` for input, `import` for screenshots, env `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`. Without them (the user's CachyOS machine, sessions 9–10): Vite started through its JS API with a script injected that mocks `window.__TAURI_INTERNALS__.invoke`, screenshotted with Playwright's cached headless Chromium over the DevTools protocol (scripts lived in the session scratchpad). Note: `cargo test`/`cargo clippy` rebuild `target/debug/gitpilot` in dev-server mode — use `target/release/gitpilot` or `npm run tauri dev` for manual runs.
