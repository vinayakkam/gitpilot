# Changelog

## 0.2.0 — 2026-10-20

### Added
- **Line-level staging.** Click the `+` / `−` markers in a diff to pick individual lines (Shift-click for a range), then "Stage N lines" or "Unstage N lines". Works in unified and side-by-side views. Deletions and their replacements are paired, so a partial selection keeps lines in their natural order.
- **Cancel long operations.** Fetch and push show a Cancel button in the progress strip; Clone has "Stop cloning". Git is asked to stop gracefully so it cleans up its own lock files, and a cancelled clone's partly downloaded folder is removed.
- **Merge** and **rebase** from the Branches view (right-click or `…` on a branch), with explanations of what each does. Rebasing a published branch requires an explicit acknowledgement that a force push will be needed.
- **Cherry-pick** commits from the Compare dialog (commits that exist only on the other branch).
- **Revert** a commit from History (context menu or the button in the commit details). Creates a new commit; history isn't rewritten.
- **Continue / Skip / Abort** for paused merges, rebases, cherry-picks and reverts, right in the Changes view. Abort and Skip ask for confirmation. Continue is disabled until every conflict is marked resolved.
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
