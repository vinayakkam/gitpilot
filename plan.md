# GitPilot roadmap to 1.0

## 0.6.0: working with others

**Pull requests:**
- Comment on a line from the diff and reply to existing comments.
- Suggested changes.
- Mark a draft ready, request reviewers, add labels.
- Re-run failed checks.

**Background fetch:**
- One notice when a remote needs a password, instead of skipping silently.
- Optional desktop notifications when GitPilot isn't in front (new notification permission, off by default).

**Docs:** remove the outdated known issues.

## 0.7.0: safety and understanding

- Undo the last operation (pull, merge, rebase, reset, cherry-pick) from a toast, with a confirmation first.
- Bisect, guided: mark commits "good" or "bad" to find the one that broke something, with plain explanations and Stop.
- Preview before merge or rebase: which commits will come in, which files may conflict.
- Conflict resolver: a three-way view (base, yours, theirs).
- Stashes: see what a stash contains, and apply a single file from it.

## 0.8.0: big repositories and speed

- Lay out only the visible part of the history graph.
- Show huge untracked folders as one row.
- Sparse checkout and partial clone in the UI (big monorepos).
- Faster startup and lower memory use, measured with tests like the 50,000-file one.

## 0.9.0: feature freeze, release candidate

No new features from here on. This release proves everything works for real:

- Check every half-verified feature against the real services:
  - GitHub sign-in, pull request review, issues, HTTPS sign-in
  - AI providers other than Claude Code
  - the Arch in-app update end to end
  - multiple windows, GPG signing, editors and merge tools
- A keyboard and screen-reader pass by hand.
- Copy diagnostics (version, OS, Git version, recent errors with secrets removed) for bug reports.
- Export and import settings.
- A user guide.

**Needs you:**
- A Windows code-signing certificate, so SmartScreen stops warning.
- A GitHub OAuth app, so the browser sign-in is built in.
- One or more release-candidate builds (0.9.1, 0.9.2…) until there are no known serious bugs.

## 1.0.0: final

- Only bug fixes from the 0.9 releases.
- The settings file format and data folder are guaranteed stable from here on.
- Final docs (README, install guide, changelog) and the release.

After 1.0: only bug-fix releases (1.0.x). Anything new goes in a later plan.
