# Contributing to GitPilot

Thanks for helping make GitPilot better. This guide covers how to report problems, set up the project, and get a change merged.

GitPilot is a desktop Git manager for Windows and Linux, built with Tauri 2 (Rust) and React. Its core principle shapes every change: **make Git understandable, make risky operations safe, and feel like real desktop software.**

## Ways to contribute

- **Report a bug.** Open an issue with:
  - your OS (Windows 10/11, distro and version)
  - how you installed GitPilot (installer, MSI, .deb, AppImage, pacman)
  - the GitPilot version (Settings → About)
  - the steps to reproduce
  - what you expected and what happened

  Paste the text from **Technical details** under the error, if there is one. Screenshots help. Don't post tokens, API keys or private repository URLs.
- **Suggest a feature.** Open an issue that describes the problem you're trying to solve, not only the solution. The planned roadmap is in `DEVELOPMENT.md` → *Roadmap*.
- **Send a pull request.** For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.
- **Improve the docs.** Clearer wording in the app, README or guides is always welcome.

## Project setup

### Prerequisites

| | Linux | Windows |
|---|---|---|
| Node.js | 20 or newer | 20 or newer |
| Rust | stable (via [rustup](https://rustup.rs)) | stable, MSVC toolchain |
| Git | 2.30 or newer | Git for Windows |
| System libraries | see below | Microsoft C++ Build Tools, WebView2 (included in Windows 11) |

Linux build libraries:

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev build-essential file

# Arch / CachyOS / Manjaro
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 libayatana-appindicator \
  librsvg base-devel file
```

### Run it

```bash
git clone https://github.com/vinayakkam/gitpilot.git
cd gitpilot
npm install
npm run tauri dev        # the app with hot reload
```

`npm run dev` starts only the web UI in a browser. It can't reach the Rust backend, so most screens won't load. Use `npm run tauri dev` for real work.

## Before you open a pull request

Run all of these. CI and reviewers expect them to pass.

```bash
npm run typecheck                                   # TypeScript
npm run lint                                        # ESLint
npm test                                            # frontend tests (Vitest)
cd src-tauri
cargo fmt --check                                   # Rust formatting
cargo clippy --all-targets -- -D warnings           # Rust lints, no warnings allowed
cargo test                                          # Rust unit + integration tests
```

`cargo test` needs `git` on your PATH. The integration tests create throwaway repositories in a temp folder and never touch your own repos.

If you changed a Rust type that's sent to the frontend, `cargo test` regenerates the TypeScript types in `src/bindings/`. **Commit those generated files with your change.**

## How the code is organised

```
src/                      React app (TypeScript)
  bindings/               generated from Rust — don't edit by hand
  lib/api.ts              the only place that calls the backend (invoke)
  store/                  app-wide state
  components/ui/          shared building blocks (Button, Dialog, Menu…)
  features/<area>/        one folder per screen: changes, diff, history,
                          branches, remotes, settings, assistant…
  styles/tokens.css       colours, sizes and fonts for light and dark themes
src-tauri/                Rust backend
  src/commands/           Tauri commands, grouped by area (kept thin)
  src/git/                everything that runs git
  tests/                  integration tests against real temporary repos
docs/                     guides (code signing, updates)
packaging/                Arch package and Windows installer artwork
```

`CLAUDE.md` describes the architecture and key decisions in more depth. `DEVELOPMENT.md` tracks status, known issues and the roadmap.

## Rules that keep GitPilot safe

These aren't style preferences. Reviews will block a change that breaks them.

- **Git runs only through `src-tauri/src/git/runner.rs`.** It runs with a list of arguments, never through a shell and never by joining strings into a command.
- **The frontend never sends file-system paths for a repository.** Commands take a repository id, and the backend looks up the path. File paths from the UI are validated (relative, no `..`) and always passed after `--`.
- **Destructive actions need two locks:**
  - a confirmation dialog that says what will be lost
  - an explicit flag on the backend command (for example `confirmed: true`)
- **Back up before anything that rewrites history or discards work.** Follow the existing pattern in `git/rewrite.rs`.
- **No force-push** without `--force-with-lease` and a second confirmation. **No automatic stashing.** Never stage files the user didn't choose.
- **Never log or display secrets.** API keys live in the OS keychain (`secrets.rs`). Remote URLs and Git output pass through `redact.rs` before reaching the UI.
- **Errors are explained, not dumped.** Return an `AppError` with a plain-language `message`; raw Git output goes in `detail`.
- **Keep app permissions minimal.** Don't widen `src-tauri/capabilities/`. External links go through `openLink()` in `src/lib/links.ts`.

## Code style

**TypeScript and React**
- Strict mode, no `any`.
- Function components, one per file, with PascalCase file names.
- Feature code goes in `features/<area>`; shared pieces go in `components/ui`.
- Call the backend only through `src/lib/api.ts`.

**Rust**
- `cargo fmt`, and clippy with no warnings.
- Command names are `snake_case` verbs grouped by area (`stage_paths`, `branch_create`).
- Keep command functions thin. Put the logic in `git/`, `settings.rs` and so on, where it can be unit-tested.

**Styling**
- Use the semantic Tailwind classes backed by `tokens.css` (`bg-surface`, `text-muted`, `text-accent-text`…).
- Never hard-code colours. This keeps light/dark themes and accent colours working.
- No gradients or decorative shadows.
- Status is always shown with an icon or letter as well as a colour.

**Writing in the app**
- Sentence case.
- Plain words a Git beginner understands.
- Say what will happen and how to undo it.

## Tests

- **Git behaviour:** add or extend an integration test in `src-tauri/tests/git_workflow.rs` that runs real `git` in a temporary repository.
- **Pure logic** (parsing, patch building, layout): add unit tests next to the code.
- **UI:** use Vitest with Testing Library, and mock `@/lib/api` at the module boundary (see existing `*.test.tsx` files).
- **Bug fixes:** include a test that fails without the fix whenever you can.

## Commits and pull requests

- Keep each pull request focused on one change. Separate refactoring from behaviour changes.
- Write commit messages in the imperative mood ("Add tag deletion", not "Added…"), with a short summary line under 72 characters.
- In the pull request description, include:
  - **what** changed and **why**
  - **how you tested it**, and on which OS
  - **screenshots** for any UI change, in light and dark theme if colours are involved
- Add a line under a new **Unreleased** heading at the top of `CHANGELOG.md` for anything users will notice.
- If your change affects architecture or adds an important decision, update `CLAUDE.md` or `DEVELOPMENT.md` too.

## Platform notes

- GitPilot supports **Windows and Linux**. If you can only test on one, say which in your pull request.
- Windows-only code paths include:
  - Git detection in `git/locate.rs`
  - `CREATE_NO_WINDOW` when starting processes
  - Credential Manager for keys
  - launching Claude Code in a new console
- Line endings matter on Windows. GitPilot's own line-ending guard will warn you if you're about to commit CRLF into this LF repository.

## Releases

Maintainers handle releases:
1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `packaging/arch/PKGBUILD`.
2. Move the **Unreleased** changelog entries under the new version.
3. Push a `v<version>` tag. The GitHub workflow builds the installers, signs the update packages and publishes the release.

Contributors don't need to do any of this.

## License

GitPilot is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

---

Questions? Open an issue on GitHub. Thanks for contributing!
