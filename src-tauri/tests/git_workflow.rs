//! Integration tests against real temporary repositories. Never touches the developer's repos.

use std::path::{Path, PathBuf};
use std::sync::Once;

use gitpilot_lib::error::ErrorKind;
use gitpilot_lib::git::locate::locate_git;
use gitpilot_lib::git::log::LogQuery;
use gitpilot_lib::git::repo::{self, PullStrategy, RepoState};
use gitpilot_lib::git::status::{Area, ChangeType};
use gitpilot_lib::git::{Git, Repo};
use tempfile::TempDir;

static ENV: Once = Once::new();

/// Isolate from the developer's git config: a throwaway global config with an identity.
fn setup_env() {
    ENV.call_once(|| {
        let dir = std::env::temp_dir().join(format!("gitpilot-test-home-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("gitconfig");
        std::fs::write(
            &cfg,
            "[user]\n\tname = Test User\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n",
        )
        .unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &cfg);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("XDG_DATA_HOME", dir.join("xdg-data"));
    });
}

fn git() -> Git {
    setup_env();
    Git::new(locate_git(None).expect("git must be installed to run tests"))
}

async fn new_repo(g: &Git) -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    repo::init(g, dir.path(), Some("main")).await.unwrap();
    let root = repo::discover(g, dir.path()).await.unwrap();
    (dir, root)
}

fn write(root: &Path, rel: &str, content: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

#[tokio::test]
async fn end_to_end_stage_commit_history() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };

    // Empty repo: unborn, no history.
    let st = r.status().await.unwrap();
    assert!(st.branch.unborn);
    assert_eq!(st.branch.head.as_deref(), Some("main"));
    assert!(r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 50,
            search: None,
            path: None
        })
        .await
        .unwrap()
        .commits
        .is_empty());

    write(&root, "src/hello world.txt", "one\ntwo\nthree\n");
    write(&root, "café.md", "# Notes\n");
    let st = r.status().await.unwrap();
    assert_eq!(
        st.files
            .iter()
            .filter(|f| f.area == Area::Untracked)
            .count(),
        2
    );

    // Diff of an untracked file is read-only and doesn't change status.
    let d = r
        .file_diff("src/hello world.txt", Area::Untracked, None)
        .await
        .unwrap();
    assert_eq!(d.additions, 3);
    assert_eq!(r.status().await.unwrap().files.len(), 2);

    // Nothing staged → precise error; empty message → precise error.
    assert_eq!(
        r.commit("msg").await.unwrap_err().kind,
        ErrorKind::NothingToCommit
    );
    r.stage(&["src/hello world.txt".into(), "café.md".into()])
        .await
        .unwrap();
    assert_eq!(
        r.commit("   \n").await.unwrap_err().kind,
        ErrorKind::EmptyMessage
    );

    // Unstage in an unborn repo, then stage again.
    r.unstage(&["café.md".into()]).await.unwrap();
    let st = r.status().await.unwrap();
    assert!(st
        .files
        .iter()
        .any(|f| f.path == "café.md" && f.area == Area::Untracked));
    r.stage_all().await.unwrap();

    let msg = "Add notes and hello\n\nMultiline body with \"quotes\" and $(not a shell).";
    let hash = r.commit(msg).await.unwrap();
    assert_eq!(hash.len(), 40);
    let st = r.status().await.unwrap();
    assert!(st.files.is_empty());
    assert!(!st.branch.unborn);

    let detail = r.commit_detail(&hash).await.unwrap();
    assert_eq!(detail.message, msg, "multiline message preserved exactly");
    assert!(
        detail.summary.parents.is_empty(),
        "root commit has no parents"
    );
    assert_eq!(detail.files.len(), 2);
    assert!(detail.files.iter().all(|f| f.change == ChangeType::Added));
    let fd = r
        .commit_file_diff(&hash, "src/hello world.txt", None)
        .await
        .unwrap();
    assert!(fd.new_file);
    assert_eq!(fd.additions, 3);

    // Search by message and by hash prefix.
    let page = r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 10,
            search: Some("NOTES".into()),
            path: None,
        })
        .await
        .unwrap();
    assert_eq!(page.commits.len(), 1);
    let page = r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 10,
            search: Some(hash[..8].into()),
            path: None,
        })
        .await
        .unwrap();
    assert_eq!(page.commits[0].hash, hash);
}

#[tokio::test]
async fn hunk_level_staging_round_trip() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let original: String = (1..=40).map(|i| format!("line {i}\r\n")).collect();
    write(&root, "f.txt", &original);
    r.stage_all().await.unwrap();
    r.commit("base").await.unwrap();

    // Two separated edits → two hunks. CRLF endings must survive.
    let edited = original
        .replace("line 3\r\n", "LINE THREE\r\n")
        .replace("line 35\r\n", "LINE 35\r\n");
    write(&root, "f.txt", &edited);
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    assert_eq!(d.hunks.len(), 2);
    assert!(d.hunk_actions);
    assert!(d.hunks[0].lines.iter().any(|l| l.crlf));

    r.apply_hunk("f.txt", &d.hunks[1].header, false)
        .await
        .unwrap();
    let staged = r.file_diff("f.txt", Area::Staged, None).await.unwrap();
    let unstaged = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    assert_eq!(staged.hunks.len(), 1);
    assert!(staged.hunks[0].lines.iter().any(|l| l.content == "LINE 35"));
    assert_eq!(unstaged.hunks.len(), 1);
    assert!(unstaged.hunks[0]
        .lines
        .iter()
        .any(|l| l.content == "LINE THREE"));

    // Unstage that hunk again.
    r.apply_hunk("f.txt", &staged.hunks[0].header, true)
        .await
        .unwrap();
    let staged = r.file_diff("f.txt", Area::Staged, None).await.unwrap();
    assert!(staged.hunks.is_empty());

    // A stale header is refused rather than applied to the wrong place.
    let err = r
        .apply_hunk("f.txt", "@@ -1,1 +1,1 @@", false)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);

    // Working file untouched by all of the above.
    assert_eq!(std::fs::read_to_string(root.join("f.txt")).unwrap(), edited);
}

#[tokio::test]
async fn discard_keeps_backup_and_guards_tracked_files() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "keep.txt", "v1\n");
    r.stage_all().await.unwrap();
    r.commit("v1").await.unwrap();
    write(&root, "keep.txt", "v2 local edit\n");

    let backups = tempfile::tempdir().unwrap();
    let res = r
        .discard_tracked(&["keep.txt".into()], backups.path())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("keep.txt")).unwrap(),
        "v1\n"
    );
    let saved = PathBuf::from(res.backup_dir.unwrap()).join("keep.txt");
    assert_eq!(std::fs::read_to_string(saved).unwrap(), "v2 local edit\n");

    // Refuses to trash a tracked file through the untracked path.
    let err = r.discard_untracked(&["keep.txt".into()]).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidInput);
    assert!(root.join("keep.txt").exists());

    // Path traversal is rejected before reaching git.
    assert!(r.stage(&["../outside".into()]).await.is_err());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn discard_untracked_moves_to_trash() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "scratch/a.txt", "x");
    write(&root, "scratch/b.txt", "y");
    let res = r.discard_untracked(&["scratch".into()]).await;
    match res {
        Ok(res) => {
            assert_eq!(res.trashed, 1);
            assert!(!root.join("scratch").exists());
        }
        // Some CI containers have no usable trash; the files must then be untouched.
        Err(_) => assert!(root.join("scratch/a.txt").exists()),
    }
}

#[tokio::test]
async fn branches_are_managed_safely() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "a.txt", "a\n");
    r.stage_all().await.unwrap();
    r.commit("a").await.unwrap();

    r.branch_create("feature/x", None, true).await.unwrap();
    assert_eq!(
        r.status().await.unwrap().branch.head.as_deref(),
        Some("feature/x")
    );
    assert_eq!(
        r.branch_delete("feature/x", false).await.unwrap_err().kind,
        ErrorKind::InvalidInput
    );
    assert!(r.branch_create("--bad", None, false).await.is_err());
    assert!(r.branch_create("has space", None, false).await.is_err());

    write(&root, "b.txt", "b\n");
    r.stage_all().await.unwrap();
    r.commit("b on feature").await.unwrap();
    r.branch_switch("main").await.unwrap();

    let branches = r.branches().await.unwrap();
    let feat = branches.iter().find(|b| b.name == "feature/x").unwrap();
    assert_eq!(feat.merged, Some(false));
    let cmp = r.branch_compare("main", "feature/x").await.unwrap();
    assert_eq!((cmp.ahead.len(), cmp.behind.len()), (1, 0));

    // Unmerged branch: safe delete is refused by git.
    assert_eq!(
        r.branch_delete("feature/x", false).await.unwrap_err().kind,
        ErrorKind::BranchNotMerged
    );

    // Switching with conflicting local changes is refused, and the changes are kept.
    r.branch_switch("feature/x").await.unwrap();
    r.branch_switch("main").await.unwrap();
    write(&root, "b.txt", "untracked would be overwritten\n");
    let err = r.branch_switch("feature/x").await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::LocalChangesWouldBeOverwritten);
    assert_eq!(
        std::fs::read_to_string(root.join("b.txt")).unwrap(),
        "untracked would be overwritten\n"
    );
    std::fs::remove_file(root.join("b.txt")).unwrap();

    r.branch_rename("feature/x", "feature/y").await.unwrap();
    r.branch_delete("feature/y", true).await.unwrap();
    assert!(!r
        .branches()
        .await
        .unwrap()
        .iter()
        .any(|b| b.name.starts_with("feature/")));

    // Stash round trip.
    write(&root, "a.txt", "changed\n");
    r.stash_push("wip", true).await.unwrap();
    assert_eq!(r.status().await.unwrap().stash_count, 1);
    assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "a\n");
    r.stash_apply(0, true).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "changed\n"
    );
}

#[tokio::test]
async fn remotes_push_pull_fetch_with_local_bare_remote() {
    let g = git();
    let bare = tempfile::tempdir().unwrap();
    g.run(
        bare.path(),
        ["init", "--bare", "-b", "main"],
        Default::default(),
    )
    .await
    .unwrap();
    let url = bare.path().display().to_string();

    let (_d1, a) = new_repo(&g).await;
    let ra = Repo { git: &g, path: &a };
    assert!(ra.remote_add("origin", "ext::sh -c id").await.is_err());
    ra.remote_add("origin", &url).await.unwrap();
    assert_eq!(ra.remotes().await.unwrap()[0].name, "origin");

    write(&a, "x.txt", "1\n");
    ra.stage_all().await.unwrap();
    ra.commit("one").await.unwrap();
    // No upstream yet → push publishes and sets upstream.
    ra.push(None, false, false, |_| {}).await.unwrap();
    let st = ra.status().await.unwrap();
    assert_eq!(st.branch.upstream.as_deref(), Some("origin/main"));
    assert_eq!((st.branch.ahead, st.branch.behind), (Some(0), Some(0)));

    // Clone into a second working copy.
    let parent = tempfile::tempdir().unwrap();
    let mut lines = Vec::new();
    let b = repo::clone(&g, &url, &parent.path().join("copy"), |l| lines.push(l))
        .await
        .unwrap();
    let rb = Repo { git: &g, path: &b };
    assert_eq!(
        rb.status().await.unwrap().branch.head.as_deref(),
        Some("main")
    );
    assert!(
        repo::clone(&g, &url, &parent.path().join("copy"), |_| {})
            .await
            .is_err(),
        "won't clone into non-empty dir"
    );

    // A pushes again; B fetches → behind 1 → ff pull.
    write(&a, "x.txt", "1\n2\n");
    ra.stage_all().await.unwrap();
    ra.commit("two").await.unwrap();
    ra.push(None, false, false, |_| {}).await.unwrap();
    rb.fetch(None, |_| {}).await.unwrap();
    let st = rb.status().await.unwrap();
    assert_eq!(st.branch.behind, Some(1));
    assert!(st.last_fetch.is_some());
    rb.pull(PullStrategy::FfOnly, |_| {}).await.unwrap();
    assert_eq!(std::fs::read_to_string(b.join("x.txt")).unwrap(), "1\n2\n");

    // Divergence: B commits, A pushes → B's push is rejected (never forced).
    write(&b, "b.txt", "b\n");
    rb.stage_all().await.unwrap();
    rb.commit("from b").await.unwrap();
    write(&a, "a.txt", "a\n");
    ra.stage_all().await.unwrap();
    ra.commit("from a").await.unwrap();
    ra.push(None, false, false, |_| {}).await.unwrap();
    let err = rb.push(None, false, false, |_| {}).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PushRejected);
    // ff-only pull refuses to merge diverged history.
    assert!(rb.pull(PullStrategy::FfOnly, |_| {}).await.is_err());
    rb.pull(PullStrategy::Merge, |_| {}).await.unwrap();
    rb.push(None, false, false, |_| {}).await.unwrap();

    // Remote branch listing and deletion.
    ra.fetch(Some("origin"), |_| {}).await.unwrap();
    ra.branch_create("topic", None, false).await.unwrap();
    ra.branch_switch("topic").await.unwrap();
    ra.push(Some("origin"), true, false, |_| {}).await.unwrap();
    assert!(ra
        .branches()
        .await
        .unwrap()
        .iter()
        .any(|b| b.is_remote && b.name == "origin/topic"));
    ra.remote_branch_delete("origin", "topic").await.unwrap();
    ra.fetch(None, |_| {}).await.unwrap();
    let br = ra.branches().await.unwrap();
    assert!(!br.iter().any(|b| b.is_remote && b.name == "origin/topic"));
    assert!(br.iter().find(|b| b.name == "topic").unwrap().upstream_gone);

    ra.remote_set_url("origin", "https://user:secret@example.com/r.git")
        .await
        .unwrap();
    let rem = &ra.remotes().await.unwrap()[0];
    assert!(rem.has_credentials && !rem.fetch_url.contains("secret"));
    ra.remote_remove("origin").await.unwrap();
    assert!(ra.remotes().await.unwrap().is_empty());
}

#[tokio::test]
async fn merge_conflicts_are_reported() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "c.txt", "base\n");
    r.stage_all().await.unwrap();
    r.commit("base").await.unwrap();
    r.branch_create("other", None, true).await.unwrap();
    write(&root, "c.txt", "theirs\n");
    r.stage_all().await.unwrap();
    r.commit("other").await.unwrap();
    r.branch_switch("main").await.unwrap();
    write(&root, "c.txt", "ours\n");
    r.stage_all().await.unwrap();
    r.commit("main").await.unwrap();
    let _ = g.run(&root, ["merge", "other"], Default::default()).await; // conflicts (expected failure)

    let st = r.status().await.unwrap();
    assert_eq!(st.state, RepoState::Merging);
    let c = st
        .files
        .iter()
        .find(|f| f.area == Area::Conflicted)
        .unwrap();
    assert_eq!(c.conflict.as_deref(), Some("both modified"));
    let view = r.file_diff("c.txt", Area::Conflicted, None).await.unwrap();
    assert!(view.conflict_view);
    assert!(view.hunks[0].lines.len() >= 5);

    // Resolve, stage, and commit the merge.
    write(&root, "c.txt", "resolved\n");
    r.stage(&["c.txt".into()]).await.unwrap();
    r.commit("Merge branch 'other'").await.unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.state, RepoState::Normal);
    let page = r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 1,
            search: None,
            path: None,
        })
        .await
        .unwrap();
    assert_eq!(page.commits[0].parents.len(), 2);
    assert!(page.has_more);
    let detail = r.commit_detail(&page.commits[0].hash).await.unwrap();
    assert!(detail.compared_to_first_parent);
}

#[cfg(unix)]
#[tokio::test]
async fn failing_pre_commit_hook_is_reported_not_bypassed() {
    use std::os::unix::fs::PermissionsExt;
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let hook = root.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'lint failed: trailing whitespace' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    write(&root, "x.txt", "x\n");
    r.stage_all().await.unwrap();
    let err = r.commit("try").await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::HookFailed);
    assert!(err.detail.unwrap().contains("lint failed"));
    assert!(
        r.status().await.unwrap().branch.unborn,
        "no commit was created"
    );
}

#[tokio::test]
async fn non_repository_and_missing_paths() {
    let g = git();
    let d = tempfile::tempdir().unwrap();
    assert_eq!(
        repo::discover(&g, d.path()).await.unwrap_err().kind,
        ErrorKind::NotARepository
    );
    assert_eq!(
        repo::discover(&g, &d.path().join("nope"))
            .await
            .unwrap_err()
            .kind,
        ErrorKind::PathNotFound
    );
    let sub = d.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    repo::init(&g, d.path(), None).await.unwrap();
    // Discovering from a subfolder resolves the repository root.
    let root = repo::discover(&g, &sub).await.unwrap();
    assert_eq!(
        std::fs::canonicalize(root).unwrap(),
        std::fs::canonicalize(d.path()).unwrap()
    );
}
