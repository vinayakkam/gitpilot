# GitPilot

A desktop Git manager for Windows and Linux. GitPilot shows exactly what changed, lets you choose what goes into each commit (down to individual hunks), and keeps branches and remotes in sync — explaining in plain language whenever Git refuses something.

Built with Tauri 2 (Rust) and React. It runs your installed `git` executable; nothing is simulated.

> Status: v0.5.1. Linux is built and tested; Windows installers are built by the GitHub Actions workflow and have been used on Windows. See [Known limitations](#known-limitations).

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
- **GitHub** — sign in (with a personal access token, or in the browser with a one-time code when an OAuth app is configured; kept in the OS keychain), clone from your repository list, see open pull requests with checks and review state, check one out (forks too), and open new pull requests, as drafts if you like. **Review pull requests** in GitPilot (files, conversation, checks; comment, approve, request changes, merge), work with **issues** (search, create, Start work on a branch named after the issue), and use the sign-in for **HTTPS clone/fetch/push to github.com** (can be turned off).
- **AI help (optional, off by default)** — explain a commit or a file's changes, draft a pull request title and description, and get suggested resolutions for merge conflicts that you review (and can edit) before applying.
- **AI commit messages (optional, off by default)** — OpenRouter (default: hundreds of models with one key, including free ones), your own Claude account through Claude Code (no API key), the Anthropic API, or any OpenAI-compatible API (OpenAI, Ollama, LM Studio…). Sends only the staged diff, skips files that look like secrets, never commits for you.
- **Fix and reshape history safely** — amend or undo the last commit, edit commits (reorder, combine, reword, remove), reset a branch to any commit, and restore from automatic backups.
- **Conflict resolver** — Keep mine / Keep theirs / Keep both per conflict or per file.
- **Understand code** — blame, a commit graph, file-by-file compare of any two branches/tags/commits, and before/after image previews.
- **Tags, stash selected files, discard single hunks or lines, and auto-refresh** when files change, plus **background fetch** (as often as every 15 seconds) that tells you when there's something to pull and when your pull request's checks or reviews change.
- **Recover lost work** — Branches → Recover shows where the repository has been (resets, rebases, switches) and GitPilot's backups in one list, and marks commits no branch keeps; create a branch at any point or restore a backup. Force-deleted branches are backed up.
- **Search history by content** — find commits that added or removed some text or match a regular expression, within a date range and a file or folder.
- **Your editor, terminal and merge tool** — open the repository, a file or a Blame line in VS Code, Zed, JetBrains IDEs and others; open a terminal there; resolve conflicts in meld, kdiff3 or any `git mergetool`.
- **Tips for beginners** — a short explanation the first time you stage, commit, publish, hit a conflict or open pull requests.
- **.gitignore made easy** — right-click a file to ignore it, its extension or its folder; files committed before they were ignored are flagged with a one-click Stop tracking.
- **Line-ending guard** — warns before you commit Windows (CRLF) line endings into an LF repository, which makes GitHub show every line as changed and breaks pull request suggestions ("context doesn't match"). One click converts the files.
- **Coding assistant** — opens Claude Code or OpenCode in a terminal in the repository, with prompt templates filled from real repository context (branch, counts, file names, recent commits).
- **Multiple windows** — open any repository in its own window; settings apply to all windows at once.
- **Worktrees** — check out another branch in its own folder, open it, remove it safely, clean up deleted ones.
- **Submodules** — see each submodule's state, download or update them with progress.
- **Git LFS** — see which file types are stored with LFS, track new ones, and get a warning when a repository needs LFS but it isn't installed.
- **Signed commits** — set up SSH or GPG commit signing in a few clicks; History shows whether a commit's signature is verified.
- **Updates in place** — checks GitHub Releases and installs signed updates without uninstalling (Windows installers, AppImage, .deb, and the Arch package through pacman). See [docs/UPDATES.md](docs/UPDATES.md).
- **Command palette** (`Ctrl+K`) — actions, branches, repositories, file history and commit search.
- Light, dark and system themes; accent colours (classic blue by default, presets or any custom colour); comfortable/compact density; keyboard navigation throughout.

## Install

Step-by-step instructions for Windows, CachyOS/Arch and Debian/Ubuntu are in [INSTALL.md](INSTALL.md).

### Linux

Download from [GitHub Releases](https://github.com/vinayakkam/gitpilot/releases) (replace `<version>` with the version you downloaded):

- **AppImage**: `chmod +x GitPilot_<version>_amd64.AppImage && ./GitPilot_<version>_amd64.AppImage`
- **Debian/Ubuntu**: `sudo apt install ./GitPilot_<version>_amd64.deb` (pulls in `git`, WebKitGTK 4.1 and GTK 3)
- **Arch/CachyOS**: `gitpilot-bin` package — see [INSTALL.md](INSTALL.md)

Git must be installed (`sudo apt install git`, `dnf install git`, …).

### Windows

Download the MSI or the setup `.exe` from [GitHub Releases](https://github.com/vinayakkam/gitpilot/releases). The setup `.exe` (NSIS) installs per-user. Git for Windows must be installed; GitPilot looks on `PATH`, in `Program Files\Git`, `%LOCALAPPDATA%\Programs\Git`, Scoop and GitHub Desktop's bundled Git, or you can set the path in Settings → Git.

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

Output goes to `src-tauri/target/release/bundle/`. Installers are not code-signed; update packages are signed with the updater key in CI (see [docs/UPDATES.md](docs/UPDATES.md)).

See [CLAUDE.md](CLAUDE.md) for architecture and conventions and [DEVELOPMENT.md](DEVELOPMENT.md) for current status.

## AI configuration

Settings → AI:

1. Read the privacy notice and tick the acknowledgement. Staged diffs may contain proprietary code.
2. Enable suggestions and choose a provider:
   - **OpenRouter** (default): create a key at openrouter.ai/keys, paste it, then pick a model from the list (search, prices, "Free only"). The default is OpenRouter's Auto router.
   - **Claude Code**: uses the Claude account you're signed in to in Claude Code (Pro, Max, Team or Enterprise), so no API key is needed. Click **Sign in with Claude** if you aren't signed in yet. Pick Haiku, Sonnet or Opus. Usage counts toward your plan's limits.
   - **Anthropic API** or **OpenAI-compatible** (for a local model, use a base URL like `http://localhost:11434/v1`).
3. Keys go to the OS keychain (Secret Service on Linux, Credential Manager on Windows), never to the settings file. Without a keychain, set `GITPILOT_AI_API_KEY` (or `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) before starting GitPilot.

## GitHub

Settings → GitHub → **Sign in to GitHub**:

- **With a token** (always available): create a [classic token with the `repo` scope](https://github.com/settings/tokens/new?scopes=repo&description=GitPilot), or a fine-grained token with read and write access to Contents and Pull requests, and paste it. GitPilot checks it with GitHub and keeps it in the OS keychain. Without a keychain, set `GITPILOT_GITHUB_TOKEN` (or `GH_TOKEN` / `GITHUB_TOKEN`) before starting GitPilot.
- **In the browser** (device flow): GitPilot shows a code to enter at github.com/login/device. This needs a GitHub OAuth app with device flow enabled. Its client ID is either built in (`GITPILOT_GITHUB_CLIENT_ID` at build time; the release workflow reads a repository variable of the same name) or entered under Settings → GitHub → Sign-in app.

The sign-in is used for GitHub's API (repository list, pull requests, issues) and, unless you turn it off under Settings → GitHub → Git over HTTPS, for cloning, fetching and pushing `https://github.com` repositories. GitPilot hands it to Git as a request header in the environment, for github.com only; it is never written to a Git config file or the command line. SSH addresses and other hosts keep using your credential manager or SSH keys.

## Coding assistant (Claude Code or OpenCode)

Choose the assistant in Settings → Coding assistant. GitPilot finds `claude` or `opencode` on `PATH` or in common install locations (`~/.local/bin`, `~/.claude/local`, `~/.opencode/bin`, npm global), or uses the path you set. The Assistant view builds a prompt from the repository's real state and opens the assistant in a terminal in that folder (on Linux, `$TERMINAL` or the first known emulator; configurable); OpenCode receives the prompt with `--prompt`. GitPilot never runs commands an assistant suggests.

## Troubleshooting

- **"Git isn't installed or couldn't be found"** — install Git or set its path in Settings → Git.
- **Authentication failed** — GitPilot uses your existing credential helper and SSH agent and never prompts for passwords. Make sure `git fetch` works from a terminal for that remote. For `https://github.com` remotes, the GitHub sign-in is used when Settings → GitHub → Git over HTTPS is on; sign in again if it expired.
- **"GitHub couldn't start the sign-in"** — the OAuth app's client ID is wrong or device flow isn't enabled for the app. Sign in with a token instead, or fix the client ID in Settings → GitHub.
- **Blank window on Linux under some GPU/virtual setups** — try `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **"The system keychain isn't available"** — start a Secret Service (GNOME Keyring, KWallet) or use the environment variable fallback.
- **"A submodule points to a folder on this computer"** — Git blocks submodules that use local paths unless you allow it (`git config protocol.file.allow always`). Only do this for repositories you trust.
- **Signed commits fail** — GitPilot uses your key as is: a passphrase-protected SSH key needs to be loaded in your SSH agent, and a GPG key needs a working pinentry.
- **Pull says branches diverged** — the default pull is fast-forward only. Choose merge or rebase in Settings → Git.

## Known limitations

- Windows: the test suite isn't run on Windows in CI yet (installers are built there and have been used on Windows).
- Installers are unsigned until a code-signing certificate is configured — see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md). Until then Windows shows a SmartScreen warning.
- macOS is not a target.
- Pull can't be cancelled once started.
- Submodule updates can be cancelled, but a stopped update can leave a submodule half downloaded; run Update again.
- GitHub features work with github.com only (not GitHub Enterprise Server), and list up to 1,000 of your repositories and the 50 most recently updated open pull requests.
- Of the AI providers, only Claude Code has been exercised live; OpenRouter, Anthropic and OpenAI-compatible requests follow the documented APIs but haven't been run against the real services.

## Security and privacy

- Git runs with argument vectors only (no shell); file paths always follow `--` with literal pathspecs; command-executing remote transports (`ext::`, `fd::`) are blocked.
- The frontend refers to repositories by id; the backend decides which folder Git runs in.
- Credentials in remote URLs are redacted everywhere they're displayed, including submodule URLs.
- AI keys and the GitHub token live in the OS keychain, never in the settings file. The GitHub token is sent only to api.github.com.
- AI suggestions never change anything by themselves: conflict suggestions are applied only when you choose one, and only if the conflict still matches what the AI saw.
- Destructive operations require confirmation in the UI *and* an explicit flag in the backend command.
- Tauri capabilities are limited to the folder picker and confirmation dialogs, clipboard writes, opening `https://` links, and the updater (download, install, restart).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Vinayak Kamath
