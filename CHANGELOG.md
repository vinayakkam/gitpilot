# Changelog

## 0.4.2 — 2026-10-25

### GitHub
- **Sign in to GitHub.** Settings → GitHub. Paste a personal access token or, where this version offers it, sign in through your browser with a one-time code. The sign-in is kept in your system keychain, never in the settings file. Cloning, pulling and pushing keep using your usual Git credentials.
- **Clone from your repository list.** The clone window has a **Your GitHub repositories** tab: search your repositories (including organization and private ones), pick HTTPS or SSH, and the address and folder name are filled in.
- **Pull requests.** A new **Pull requests** section (Ctrl+7) lists open pull requests with their checks (passed, failed, running), review state and draft status. **Check out** brings one to your computer; a pull request from a fork gets a `pr-<number>` branch, and checking out again updates it without ever discarding your own commits. **Open on GitHub** opens it in your browser.
- **Open a pull request.** If your branch doesn't have one yet, **Create pull request** opens it from GitPilot, as a draft if you like. If the branch or some commits aren't on GitHub yet, GitPilot offers to push first. For forks, pull requests go to the original repository by default.

### AI
- **Explain a commit or a change.** The sparkles button in a commit's details (History) or above a file's diff (Changes) explains in plain language what changed.
- **Write a pull request description.** **Write with AI** in the pull request window drafts the title and description from the branch's commits and changes.
- **Conflict help.** **Ask AI** in a conflicted file suggests a resolution for each conflict, with a short explanation. Nothing changes until you choose **Use this**, and you can edit a suggestion before using it.
- As before, AI is off until you turn it on, files that look like secrets are never sent, and every answer says which model wrote it.

### Changed
- **Set up AI** buttons now open Settings at the AI section.

## 0.4.0 — 2026-10-21

### Everyday Git
- **Amend the last commit.** Tick **Amend last commit** in the commit box to change its message or add staged files to it. If that commit was already pushed, GitPilot asks first.
- **Undo the last commit.** Click **Undo** on the "Committed" message, or use History. The changes go back to staged and the message returns to the commit box.
- **Auto-refresh.** Changes appear as soon as you save a file. Folders in .gitignore (like node_modules) are skipped so large projects stay fast. Can be turned off in Settings → General.
- **Tags.** Create a tag (simple or with a message) from History or Branches, push it, or delete it locally and on the remote.
- **Stash selected files.** Right-click files in Changes to stash just those.
- **Discard a hunk or selected lines.** The opposite of line staging. A backup is kept, as with other discards.

### Understanding code
- **Blame.** See who last changed each line, and in which commit. Uncommitted lines are marked. Open it from a file's menu in Changes or History; clicking a commit opens it in History.
- **Commit graph.** History shows branches and merges as lines. It can be turned off.
- **Compare anything.** Compare two branches, tags or commits file by file, either since they split or directly. Open it from Branches or History.
- **Image previews.** Changed images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF) show before and after instead of "binary file changed".

### Conflicts and history
- **Conflict resolver.** For each conflict, choose **Keep mine**, **Keep theirs** or **Keep both**, or do it for the whole file.
- **Edit commits.** Right-click a commit in History → **Edit commits from here…** to reorder, combine, reword or remove commits.
- **Reset branch to a commit.** Right-click a commit → **Reset branch to here…** and choose to keep your changes staged, keep them unstaged, or discard everything after it.
- **Backups.** GitPilot saves a backup before every reset or commit edit. Branches → Backups lists them, and **Restore** puts the branch back (backing up the current state first, so that can be undone too).

### Fixed
- Dialogs opened from inside other dialogs now work, and Escape closes only the top one.
- Selected lines in a diff stay selected when the file list refreshes.

## 0.3.1 — 2026-10-21

### Added
- **Add to .gitignore.** Right-click any changed or new file and choose **Add to .gitignore…** to ignore that file, every file with the same extension, its whole folder, or a custom pattern. You see exactly what will be added before anything changes.
- **Files that are ignored but still tracked are explained.** Files committed before they were added to .gitignore kept showing up as changes with no explanation. They're now marked "ignored", and a notice offers **Stop tracking…**, which removes them from Git but keeps them on your computer.

### Fixed
- **Links open again.** Website, Source on GitHub, Release notes, Get a key, How to install and Open release page did nothing when clicked: GitPilot's permissions allowed opening links but not any actual address. Web links now open in your browser, and if a browser can't be opened you get a message with a Copy link button instead of silence.
- **Update notes are readable.** The update window showed release notes as raw text full of formatting symbols. It now shows proper headings, bullet points and bold text.
- **Notes look right when updating from older versions too.** The notes GitPilot downloads with an update are now clean plain text, so 0.3.0 and earlier show them neatly as well.

## 0.3.0 — 2026-10-21

### Added
- **Accent colours.** Classic blue stays the default. Settings → Appearance has 11 preset colours plus a custom colour picker, with a live preview. Buttons, selection, links and focus rings follow your choice in both light and dark themes, with readable contrast checked for every preset.
- **Line-ending guard.** Before you commit, GitPilot checks staged files for Windows line endings (CRLF) in repositories that use LF. Those commits make GitHub show every line of a file as changed, and pull request suggestions then fail with "context doesn't match". The commit box warns you and **Convert to LF** fixes the staged files and your working copies (originals are backed up). A one-click link adds `* text=auto` to `.gitattributes` so it doesn't happen again. Files meant to keep CRLF (`eol=crlf`, binary) are left alone. Can be turned off in Settings → Git.
- **OpenRouter is the default AI provider.** Save your OpenRouter key (kept in the system keychain), see that it works and how much you've used, and pick from OpenRouter's full model list with search, prices and a "Free only" filter. The default model is OpenRouter's Auto router.
- **Claude Code with your Claude account.** New AI provider: commit messages are written by Claude Code in the background using the Claude account you're signed in with (Pro, Max, Team or Enterprise), so no API key is needed. Choose Haiku, Sonnet or Opus. Settings shows whether you're signed in and has **Sign in with Claude**, which opens Claude Code's sign-in in a terminal.

### Changed
- **Settings rearranged** into General, Appearance, Git, AI, Claude Code, Updates and About, with icons and a search box. Updates and About have their own sections; line endings and commit conventions are together under Git → Committing.
- AI settings show providers as cards. Existing setups that never turned AI on move to OpenRouter; anyone who had configured a provider keeps it.
- Suggested commit message descriptions are shown reflowed in the suggestions list (the inserted text keeps its line breaks).

## 0.2.1 — 2026-10-20

### Fixed
- **Push rejected with no way to pull.** When a local branch wasn't linked to its remote copy (for example `main` vs. `origin/main` after adding a remote to an existing folder), Push was rejected with "Pull first", but Pull was disabled. Pull now works in that case and links the branch to its remote copy.
- **Branches that can't be fast-forwarded.** Instead of failing and pointing you to Settings, Pull now asks whether to **Merge** or **Rebase** this time.
- **Branches with unrelated histories** (for example, one side started from downloaded files and the other from files uploaded on GitHub) are now explained, with an option to **Combine histories** after you confirm.

### Changed
- The toolbar shows how an unlinked branch compares with its remote copy, marked **not linked**, including "Unrelated history" when the two share no commits.
- A rejected push shows a **Pull now** button in the error message.
- Push for an unlinked branch says "Push" and links the branch, instead of "Publish branch".

## 0.2.0 — 2026-10-20

### Added
- **Line-level staging.** Click the `+` / `−` markers in a diff to pick individual lines (Shift-click for a range), then "Stage N lines" or "Unstage N lines". Works in unified and side-by-side views. Deletions and their replacements are paired, so a partial selection keeps lines in their natural order.
- **Cancel long operations.** Fetch and push show a Cancel button in the progress strip; Clone has "Stop cloning". Git is asked to stop gracefully so it cleans up its own lock files, and a cancelled clone's partly downloaded folder is removed.
- **Merge** and **rebase** from the Branches view (right-click or `…` on a branch), with explanations of what each does. Rebasing a published branch requires an explicit acknowledgement that a force push will be needed.
- **Cherry-pick** commits from the Compare dialog (commits that exist only on the other branch).
- **Revert** a commit from History (context menu or the button in the commit details). Creates a new commit; history isn't rewritten.
- **Continue / Skip / Abort** for paused merges, rebases, cherry-picks and reverts, right in the Changes view. Abort and Skip ask for confirmation. Continue is disabled until every conflict is marked resolved.
- **In-app updates.** GitPilot checks GitHub Releases (at most once a day, or on demand in Settings → General) and updates itself in place: "Update to x.y.z" in the sidebar → Update now → Restart. Works for the Windows installers, AppImage and .deb; the CachyOS/Arch package points you to pacman instead. Updates are signature-checked before installing. See `docs/UPDATES.md`.
- **Branded Windows installers.** The setup EXE and MSI now show GitPilot artwork on the welcome, finish and inner pages, and list OLIT Technologies as the publisher.
- **Optional Windows code signing** in the build workflow: add a certificate as repository secrets and installers are signed automatically. See `docs/CODE_SIGNING.md`.

### Changed
- Git never opens a text editor from GitPilot (continuing a rebase/cherry-pick/revert keeps the prepared message).
- When an operation stops for conflicts, GitPilot says so as a pause, not a failure, and opens Changes.

### Fixed
- Clearer errors when uncommitted changes block a rebase, cherry-pick or revert.

### Known limitations
- Installers are still unsigned until a certificate is configured (see `docs/CODE_SIGNING.md`).
- Interactive rebase (reordering, squashing, editing commits) and reset aren't available.
- Pull can't be cancelled (stopping a pull mid-merge could leave the working tree half-updated).

## 0.1.0 — 2026-10-20

First preview: repositories, changes with hunk staging, diff viewer, commits, history, branches, stashes, remotes, fetch/pull/push, optional AI commit messages, Claude Code integration, command palette, light/dark themes. Packages for Debian/Ubuntu, Arch/CachyOS, AppImage and Windows (MSI/EXE via GitHub Actions).
