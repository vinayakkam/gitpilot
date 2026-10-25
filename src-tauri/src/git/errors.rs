//! Maps git's stderr (forced to the C locale by the runner) to user-facing errors.

use crate::error::{AppError, ErrorKind};

pub fn classify(stderr: &str) -> AppError {
    let s = stderr.to_ascii_lowercase();
    let has = |needle: &str| s.contains(needle);

    let (kind, message) = if has("refusing to merge unrelated histories") {
        (
            ErrorKind::UnrelatedHistories,
            "Your branch and the remote branch don't share any history (for example, one was started from a copy of the files). Git won't combine them unless you choose to.",
        )
    } else if has("not possible to fast-forward")
        || has("diverging branches")
        || has("need to specify how to reconcile divergent branches")
    {
        (
            ErrorKind::Diverged,
            "Your branch and the remote both have new commits, so they can't simply be fast-forwarded. Choose whether to merge or rebase.",
        )
    } else if has("not a git repository") {
        (
            ErrorKind::NotARepository,
            "This folder is not a Git repository (or it was moved or deleted).",
        )
    } else if has("please tell me who you are")
        || has("unable to auto-detect email address")
        || has("empty ident name")
    {
        (
            ErrorKind::MissingIdentity,
            "Git doesn't know who you are yet. Set your name and email in Settings → Git, or run `git config --global user.name` and `user.email`.",
        )
    } else if has("index.lock") || has("another git process seems to be running") {
        (
            ErrorKind::Locked,
            "Another Git process is using this repository. Wait for it to finish; if none is running, remove the stale .git/index.lock file.",
        )
    } else if has("transport 'file' not allowed") {
        (
            ErrorKind::Git,
            "A submodule points to a folder on this computer, and Git blocks that by default for safety. If you trust this repository, allow it with `git config protocol.file.allow always` in a terminal, then try again.",
        )
    } else if has("gpg failed to sign") || has("error: cannot run gpg") || has("failed to sign") {
        (
            ErrorKind::SigningFailed,
            "Git is configured to sign commits, but signing failed. Check your GPG/SSH signing setup; GitPilot will not skip signing.",
        )
    } else if has("would be overwritten by checkout")
        || has("would be overwritten by merge")
        || has("your local changes to the following files would be overwritten")
        || has("untracked working tree files would be overwritten")
        || has("your local changes would be overwritten")
        || has("cannot rebase: you have unstaged changes")
        || has("cannot rebase: your index contains uncommitted changes")
        || has("please commit or stash them")
    {
        (
            ErrorKind::LocalChangesWouldBeOverwritten,
            "Your uncommitted changes would be overwritten. Commit or stash them first.",
        )
    } else if has("conflict")
        && (has("merge conflict") || has("automatic merge failed") || has("could not apply"))
    {
        (
            ErrorKind::Conflict,
            "The operation stopped because of conflicts. Resolve the conflicted files, stage them, and commit.",
        )
    } else if has("you have unmerged paths") || has("unmerged files") || has("is unmerged") {
        (
            ErrorKind::Conflict,
            "There are unresolved conflicts. Resolve and stage the conflicted files first.",
        )
    } else if has("not fully merged") {
        (
            ErrorKind::BranchNotMerged,
            "This branch has commits that aren't merged anywhere. Deleting it could lose work.",
        )
    } else if has("already exists") {
        (
            ErrorKind::AlreadyExists,
            "Something with that name already exists.",
        )
    } else if has("[rejected]")
        || has("non-fast-forward")
        || has("fetch first")
        || has("updates were rejected")
    {
        (
            ErrorKind::PushRejected,
            "The remote has commits you don't have locally, so the push was rejected. Pull (or fetch and merge) first, then push again.",
        )
    } else if has("no upstream") || has("has no upstream branch") || has("no tracking information")
    {
        (
            ErrorKind::NoUpstream,
            "This branch isn't connected to a remote branch yet. Publish it or set an upstream.",
        )
    } else if has("authentication failed")
        || has("could not read username")
        || has("could not read password")
        || has("permission denied (publickey")
        || has("host key verification failed")
        || has("terminal prompts disabled")
        || has("invalid username or password")
        || has("access denied")
        || has("error: 403")
        || has("returned error: 401")
    {
        (
            ErrorKind::AuthFailed,
            "Authentication failed. GitPilot uses your existing Git credential helper and SSH keys — check that they're configured for this remote.",
        )
    } else if has("could not resolve host")
        || has("connection timed out")
        || has("connection refused")
        || has("network is unreachable")
        || has("unable to access")
        || has("could not read from remote repository")
    {
        (
            ErrorKind::NetworkFailed,
            "Couldn't reach the remote. Check your network connection and the remote URL.",
        )
    } else if has("hook")
        && (has("pre-commit") || has("commit-msg") || has("pre-push") || has("hook declined"))
    {
        (
            ErrorKind::HookFailed,
            "A Git hook rejected the operation. See the details for the hook's output.",
        )
    } else if has("nothing to commit") || has("no changes added to commit") {
        (
            ErrorKind::NothingToCommit,
            "There are no staged changes to commit.",
        )
    } else if has("permission denied") {
        (
            ErrorKind::PermissionDenied,
            "Permission denied while accessing repository files.",
        )
    } else if has("pathspec") && has("did not match") {
        (
            ErrorKind::InvalidInput,
            "Git couldn't find the requested file or reference.",
        )
    } else if has("invalid reference")
        || has("not a valid ref")
        || has("not a valid branch name")
        || has("is not a valid branch name")
    {
        (
            ErrorKind::InvalidInput,
            "That branch or reference name isn't valid.",
        )
    } else {
        (ErrorKind::Git, "Git reported an error.")
    };

    AppError::new(kind, message).with_detail(stderr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_blocked_local_submodules() {
        let e = classify("Cloning into 'deps/lib'...\nfatal: transport 'file' not allowed\nfatal: clone of '/x' into submodule path 'deps/lib' failed");
        assert!(e.message.contains("protocol.file.allow"), "{}", e.message);
    }

    #[test]
    fn classifies_common_errors() {
        assert_eq!(
            classify("fatal: not a git repository (or any of the parent directories): .git").kind,
            ErrorKind::NotARepository
        );
        assert_eq!(
            classify("Author identity unknown\n\n*** Please tell me who you are.").kind,
            ErrorKind::MissingIdentity
        );
        assert_eq!(
            classify(
                " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"
            )
            .kind,
            ErrorKind::PushRejected
        );
        assert_eq!(
            classify("fatal: Authentication failed for 'https://x.com/r.git/'").kind,
            ErrorKind::AuthFailed
        );
        assert_eq!(
            classify("ssh: Could not resolve hostname nope: Name or service not known\nfatal: Could not read from remote repository.").kind,
            ErrorKind::NetworkFailed
        );
        assert_eq!(
            classify("error: The branch 'x' is not fully merged.").kind,
            ErrorKind::BranchNotMerged
        );
    }

    #[test]
    fn classifies_pull_divergence() {
        assert_eq!(
            classify("fatal: refusing to merge unrelated histories").kind,
            ErrorKind::UnrelatedHistories
        );
        assert_eq!(
            classify("hint: ...\nfatal: Not possible to fast-forward, aborting.").kind,
            ErrorKind::Diverged
        );
    }

    #[test]
    fn detail_is_redacted() {
        let e = classify(
            "fatal: unable to access 'https://u:secret@h/r.git/': Could not resolve host: h",
        );
        assert!(!e.detail.unwrap().contains("secret"));
    }
}
