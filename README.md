# GitPilot

A desktop Git manager for Windows and Linux. GitPilot shows exactly what changed, lets you choose what goes into each commit (down to individual hunks), and keeps branches and remotes in sync — explaining in plain language whenever Git refuses something.

Built with Tauri 2 (Rust) and React. It runs your installed `git` executable; nothing is simulated.

> Status: early development (v0.1.0). Linux is built and tested. Windows installers are built by the GitHub Actions workflow — see [Known limitations](#known-limitations).

## Features

Available now:

- **Repositories** — open, clone (HTTPS/SSH, with progress) or create repositories; switch between many; detects moved/deleted folders and lets you locate them again. Removing a repository from GitPilot never touches its files.
- **Changes** — staged, unstaged, new and conflicted files in separate groups, with letter + color status markers. Stage/unstage files, selections or everything, **individual hunks, or individual lines** (real `git apply --cached` patches, CRLF-safe).
- **Discard safely** — always confirmed. Tracked files are backed up to GitPilot's data folder before being restored; new files go to the system trash.
- **Diff viewer** — unified and side-by-side, syntax highlighting for ~25 languages, line numbers, virtualized rendering for large diffs, binary/empty/rename/mode-change/line-ending/conflict handling. Read-only.
- **Commits** — summary + description, 72-character guidance, optional Conventional Commits hints, `Ctrl+Enter`, clear errors for missing identity, hooks, signing, locks. Never auto-stages, never bypasses hooks or signing.
- **History** — paged commit list, search by message, `author:name` or hash, per-file history, commit details (author vs. committer, parents, merge commits compared to first parent), per-file diffs, copy hash/message.
- **Branches** — local and remote-tracking branches with upstream ahead/behind, merged status, create/switch/rename/delete, check out remote branches, compare branches, set/unset upstream, stashes. Switching with uncommitted changes asks whether to bring them along or stash first.
- **Merge, rebase, cherry-pick, revert** — from Branches, Compare and History, with Continue / Skip / Abort when Git pauses for conflicts. Rebasing a published branch asks for explicit acknowledgement.
- **Remotes & sync** — add/edit/remove remotes (any Git host), fetch/pull/push with progress (fetch, push and clone can be cancelled), publish new branches, sync status that distinguishes up to date / ahead / behind / diverged / never fetched / no upstream. Pull is fast-forward-only by default. Force push exists only as an advanced, double-confirmed `--force-with-lease`.
- **AI commit messages (optional, off by default)** — OpenRouter (default: hundreds of models with one key, including free ones), your own Claude account through Claude Code (no API key), the Anthropic API, or any OpenAI-compatible API (OpenAI, Ollama, LM Studio…). Sends only the staged diff, skips files that look like secrets, never commits for you.
- **Fix and reshape history safely** — amend or undo the last commit, edit commits (reorder, combine, reword, remove), reset a branch to any commit, and restore from automatic backups.
- **Conflict resolver** — Keep mine / Keep theirs / Keep both per conflict or per file.
- **Understand code** — blame, a commit graph, file-by-file compare of any two branches/tags/commits, and before/after image previews.
- **Tags, stash selected files, discard single hunks or lines, and auto-refresh** when files change.
- **.gitignore made easy** — right-click a file to ignore it, its extension or its folder; files committed before they were ignored are flagged with a one-click Stop tracking.
- **.gitignore made easy** — right-click a file to ignore it, its extension or its folder; files committed before they were ignored are flagged with a one-click Stop tracking.
- **Line-ending guard** — warns before you commit Windows (CRLF) line endings into an LF repository, which makes GitHub show every line as changed and breaks pull request suggestions ("context doesn't match"). One click converts the files.
- **Claude Code** — detects the `claude` CLI, opens it in a terminal in the repository, with prompt templates filled from real repository context (branch, counts, file names, recent commits).
- **Updates in place** — checks GitHub Releases and installs signed updates without uninstalling (Windows installers, AppImage, .deb). See [docs/UPDATES.md](docs/UPDATES.md).
- **Command palette** (`Ctrl+K`) — actions, branches, repositories, file history and commit search.
- Light, dark and system themes; accent colours (classic blue by default, presets or any custom colour); comfortable/compact density; keyboard navigation throughout.

## Install

Step-by-step instructions for Windows, CachyOS/Arch and Debian/Ubuntu are in [INSTALL.md](INSTALL.md).

### Linux

Download from your build (see below):

- **AppImage**: `chmod +x GitPilot_0.1.0_amd64.AppImage && ./GitPilot_0.1.0_amd64.AppImage`
- **Debian/Ubuntu**: `sudo apt install ./GitPilot_0.1.0_amd64.deb` (pulls in `git`, WebKitGTK 4.1 and GTK 3)

Git must be installed (`sudo apt install git`, `dnf install git`, …).

### Windows

Not yet built. When built (see below), the NSIS installer installs per-user. Git for Windows must be installed; GitPilot looks on `PATH`, in `Program Files\Git`, `%LOCALAPPDATA%\Programs\Git`, Scoop and GitHub Desktop's bundled Git, or you can set the path in Settings → Git.

## Development

Prerequisites: Node 20+ (22 used here), Rust 1.80+ (1.97 used here), Git, and on Linux:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev build-essential file
```

On Windows: Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 11).

```bash
npm install
npm run tauri dev          # run the app with hot reload
```

Checks:

```bash
npm run typecheck && npm run lint && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`cargo test` also regenerates the TypeScript types in `src/bindings/` from the Rust structs (ts-rs).

Packaging:

```bash
npm run tauri build -- --bundles deb,appimage   # on Linux
npm run tauri build -- --bundles nsis,msi       # on Windows
```

Output goes to `src-tauri/target/release/bundle/`. Builds are not code-signed.

See [CLAUDE.md](CLAUDE.md) for architecture and conventions and [DEVELOPMENT.md](DEVELOPMENT.md) for current status.

## AI configuration

Settings → AI:

1. Read the privacy notice and tick the acknowledgement. Staged diffs may contain proprietary code.
2. Enable suggestions and choose a provider:
   - **OpenRouter** (default): create a key at openrouter.ai/keys, paste it, then pick a model from the list (search, prices, "Free only"). The default is OpenRouter's Auto router.
   - **Claude Code**: uses the Claude account you're signed in to in Claude Code (Pro, Max, Team or Enterprise), so no API key is needed. Click **Sign in with Claude** if you aren't signed in yet. Pick Haiku, Sonnet or Opus. Usage counts toward your plan's limits.
   - **Anthropic API** or **OpenAI-compatible** (for a local model, use a base URL like `http://localhost:11434/v1`).
3. Keys go to the OS keychain (Secret Service on Linux, Credential Manager on Windows), never to the settings file. Without a keychain, set `GITPILOT_AI_API_KEY` (or `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) before starting GitPilot.

## Claude Code integration

GitPilot finds `claude` on `PATH` or in common install locations (`~/.local/bin`, `~/.claude/local`, npm global). The Assistant view builds a prompt from the repository's real state and opens Claude Code in a terminal in that folder (on Linux, `$TERMINAL` or the first known emulator; configurable). GitPilot never runs commands that Claude suggests.

## Troubleshooting

- **"Git isn't installed or couldn't be found"** — install Git or set its path in Settings → Git.
- **Authentication failed** — GitPilot uses your existing credential helper and SSH agent and never prompts for passwords. Make sure `git fetch` works from a terminal for that remote.
- **Blank window on Linux under some GPU/virtual setups** — try `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **"The system keychain isn't available"** — start a Secret Service (GNOME Keyring, KWallet) or use the environment variable fallback.
- **Pull says branches diverged** — the default pull is fast-forward only. Choose merge or rebase in Settings → Git.

## Known limitations

- Windows: installers are built on GitHub's Windows machines but haven't been hands-on tested on a Windows PC yet.
- Installers are unsigned until a code-signing certificate is configured — see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md). Until then Windows shows a SmartScreen warning.
- macOS is not a target.
- Interactive rebase (squash/reorder/edit) and reset aren't in the UI.
- Pull can't be cancelled once started.
- Status refreshes on window focus and after operations; there's no file watcher.
- No commit graph visualization.
- The AI integration hasn't been exercised against a live provider yet.

## Security and privacy

- Git runs with argument vectors only (no shell); file paths always follow `--` with literal pathspecs; command-executing remote transports (`ext::`, `fd::`) are blocked.
- The frontend refers to repositories by id; the backend decides which folder Git runs in.
- Credentials in remote URLs are redacted everywhere they're displayed.
- Destructive operations require confirmation in the UI *and* an explicit flag in the backend command.
- Tauri capabilities are limited to the folder picker, clipboard writes and opening URLs.
