# DEVELOPMENT.md — GitPilot living tracker

## Current status

- **Phase:** 6 — reliability and refinement (phases 1–5 implemented for Linux; Windows not started)
- **Overall:** core Git workflow, branches, remotes, sync, AI provider integration, Claude Code integration and settings are implemented and verified on Linux against real repositories. Linux packages (deb, AppImage) build and launch.
- **Current working area:** cross-platform verification and remaining feature gaps
- **Most recently completed:** visual QA pass (light + dark, 900×580), fixes for diff layout bugs found there; release build with deb + AppImage
- **Blocker:** Windows cannot be built or type-checked in this environment (no Windows host; `rustup target add x86_64-pc-windows-gnu` is blocked by the network allowlist)
- **Immediate next task:** build and run on Windows (see handoff)

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
- [~] AI commit message generation (Anthropic + OpenAI-compatible; prompt/parsing unit-tested; **not exercised against a live API**)
- [x] Claude Code integration (detection verified with real CLI 2.1.304; terminal launch verified with xterm + stand-in executable; prompt passed as one argv entry)
- [x] Application settings (persisted JSON, validated; keychain for keys with env fallback)
- [x] Error handling and safety (classified errors, plain messages + technical details, confirmations + backend flags)
- [x] Automated tests (Rust 64 unit + 9 integration on temp repos; frontend 24 vitest)
- [~] UI polish and visual QA (all main screens inspected on Linux/Xvfb, light + dark, min size; no screen-reader testing)
- [-] Windows packaging (MSI + NSIS configured; GitHub Actions workflow `.github/workflows/build-installers.yml` builds them on windows-latest; workflow not yet run)
- [x] Linux packaging (deb 5.1 MB and AppImage 80 MB built; AppImage launched; Arch/CachyOS `gitpilot-bin` package built with makepkg from `packaging/arch/PKGBUILD` — not yet installed on a real Arch system)
- [~] Documentation and release preparation (README, CLAUDE.md, this file; no signing, no CI)

## Work log

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

- **Status refresh:** on window focus, after every operation, and manually (F5 / Ctrl+R / toolbar). No filesystem watcher.
- **Operations:** one at a time per window (`run()` in the store); per-repo async mutex in the backend for mutating commands.
- **Timeouts:** local git 120 s; network 15 min. Fetch/push/clone can be cancelled; pull can't (stopping mid-merge could leave a half-updated tree).
- **File list:** not virtualized (diff is). Thousands of changed files will render slowly.
- **Syntax highlighting:** per line with highlight.js (24 languages); multi-line constructs may be mis-colored.
- **Partial staging:** hunks and lines. Backend regenerates the diff and matches the hunk header byte-exactly; refuses if the hunk changed. Line selections are per hunk.
- **Discard:** tracked → backup copy in `<app_data>/discard-backups/<ms-timestamp>/` then `git restore --worktree`; untracked → OS trash, only after `git ls-files --others` confirms they're untracked.
- **Conflicts:** shown with ours/theirs regions; "Mark as resolved" stages. "Stage everything" deliberately skips conflicted files.
- **Merge/rebase/cherry-pick/revert:** started from the UI or a terminal; Continue/Skip/Abort in the Changes banner. Interactive rebase not supported.
- **AI:** off by default; requires privacy acknowledgement; staged diff only, sensitive file patterns excluded, 48 k char cap; errors never replaced with fabricated output.
- **Keychain:** Linux Secret Service via `keyring` (sync-secret-service + crypto-rust); in headless/no-DBus environments the UI shows the env-var fallback.
- **Accessibility:** labels on icon buttons, tooltips, roles for lists/menus/dialogs, keyboard navigation, focus rings, non-color status. Not tested with a screen reader.

## Known issues

1. **Windows unverified** — never compiled for Windows. Windows-only code: `git/locate.rs` candidates, `CREATE_NO_WINDOW` in `git/runner.rs` and `claude_code.rs`, `keyring` windows-native, Claude launch with `CREATE_NEW_CONSOLE`. Expect at least compile fixes (e.g. `creation_flags` on `tokio::process::Command` requires the method to be in scope on Windows — verify).
2. **AI providers not tested live** — request shapes for Anthropic Messages API (`anthropic-version: 2023-06-01`) and `/chat/completions` are written to the documented formats but no real call was made. Verify the default model id.
3. **Real Claude Code session not observed** — with the real CLI in this sandbox the terminal opened and closed immediately (the sandboxed CLI exits); the mechanism was verified with a stand-in executable. Check on a normal desktop.
4. **Detection of a hanging `claude --version`** waits up to 10 s before the Assistant enables its launch button.
5. **Native `title` tooltips** on file rows render as GTK tooltips (black) and can cover the next row.
6. **Sidebar doesn't auto-collapse** at narrow widths (user can collapse it).
8. **No CI** configured.

## Next-session handoff

**Continue with:** Windows build and verification, then live AI test.

1. On a Windows machine with Rust (MSVC), Node 20+, WebView2 and Git for Windows:
   ```
   npm install
   cd src-tauri && cargo check && cargo test && cd ..
   npm run tauri dev
   npm run tauri build -- --bundles nsis,msi
   ```
   Fix compile errors in the Windows-only paths listed under Known issues #1. Verify: git auto-detection with and without Git on PATH; no console windows flash when git runs; keychain save/remove; Claude Code launch opens a console in the repo; CRLF repositories show correct diffs and hunk staging (`core.autocrlf=true`).
2. Live AI check: set `ANTHROPIC_API_KEY`, enable AI in Settings, stage changes, click the sparkles button. Then an OpenAI-compatible endpoint (e.g. Ollama `http://localhost:11434/v1`).
3. Then pick from: line-level staging (`features/diff/DiffViewer.tsx` + new backend patch builder in `git/diff.rs`), cancellation for network ops (`git/runner.rs::run_streaming` + a cancel command), file-list virtualization (`features/changes/FileList.tsx`), CI workflow running the checks above on ubuntu + windows.

**Relevant files:** `src-tauri/src/git/runner.rs`, `src-tauri/src/git/locate.rs`, `src-tauri/src/claude_code.rs`, `src-tauri/src/secrets.rs`, `src-tauri/tauri.conf.json`.

**QA harness used this session (Linux):** Xvfb `:99` at 1440×900, `xdotool` for input, `import` for screenshots, env `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`. Note: `cargo test`/`cargo clippy` rebuild `target/debug/gitpilot` in dev-server mode — use `target/release/gitpilot` or `npm run tauri dev` for manual runs.
