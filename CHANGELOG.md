# Changelog

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
