//! Integration tests against real temporary repositories. Never touches the developer's repos.

use std::path::{Path, PathBuf};
use std::sync::Once;

use gitpilot_lib::error::ErrorKind;
use gitpilot_lib::git::diff::LineKind;
use gitpilot_lib::git::locate::locate_git;
use gitpilot_lib::git::log::LogQuery;
use gitpilot_lib::git::repo::{self, PullOptions, PullStrategy, RepoState, SequenceAction};
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
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    let st = ra.status().await.unwrap();
    assert_eq!(st.branch.upstream.as_deref(), Some("origin/main"));
    assert_eq!((st.branch.ahead, st.branch.behind), (Some(0), Some(0)));

    // Clone into a second working copy.
    let parent = tempfile::tempdir().unwrap();
    let mut lines = Vec::new();
    let b = repo::clone(&g, &url, &parent.path().join("copy"), None, |l| {
        lines.push(l)
    })
    .await
    .unwrap();
    let rb = Repo { git: &g, path: &b };
    assert_eq!(
        rb.status().await.unwrap().branch.head.as_deref(),
        Some("main")
    );
    assert!(
        repo::clone(&g, &url, &parent.path().join("copy"), None, |_| {})
            .await
            .is_err(),
        "won't clone into non-empty dir"
    );

    // A pushes again; B fetches → behind 1 → ff pull.
    write(&a, "x.txt", "1\n2\n");
    ra.stage_all().await.unwrap();
    ra.commit("two").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    rb.fetch(None, None, |_| {}).await.unwrap();
    let st = rb.status().await.unwrap();
    assert_eq!(st.branch.behind, Some(1));
    assert!(st.last_fetch.is_some());
    rb.pull(
        PullStrategy::FfOnly,
        PullOptions {
            strategy: None,
            allow_unrelated: false,
        },
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(b.join("x.txt")).unwrap(), "1\n2\n");

    // Divergence: B commits, A pushes → B's push is rejected (never forced).
    write(&b, "b.txt", "b\n");
    rb.stage_all().await.unwrap();
    rb.commit("from b").await.unwrap();
    write(&a, "a.txt", "a\n");
    ra.stage_all().await.unwrap();
    ra.commit("from a").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    let err = rb.push(None, false, false, None, |_| {}).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PushRejected);
    // ff-only pull refuses to merge diverged history.
    assert!(rb
        .pull(
            PullStrategy::FfOnly,
            PullOptions {
                strategy: None,
                allow_unrelated: false
            },
            |_| {}
        )
        .await
        .is_err());
    rb.pull(
        PullStrategy::Merge,
        PullOptions {
            strategy: None,
            allow_unrelated: false,
        },
        |_| {},
    )
    .await
    .unwrap();
    rb.push(None, false, false, None, |_| {}).await.unwrap();

    // Remote branch listing and deletion.
    ra.fetch(Some("origin"), None, |_| {}).await.unwrap();
    ra.branch_create("topic", None, false).await.unwrap();
    ra.branch_switch("topic").await.unwrap();
    ra.push(Some("origin"), true, false, None, |_| {})
        .await
        .unwrap();
    assert!(ra
        .branches()
        .await
        .unwrap()
        .iter()
        .any(|b| b.is_remote && b.name == "origin/topic"));
    ra.remote_branch_delete("origin", "topic").await.unwrap();
    ra.fetch(None, None, |_| {}).await.unwrap();
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

#[tokio::test]
async fn line_level_staging_and_unstaging() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "f.txt", "a\nb\nc\nd\n");
    r.stage_all().await.unwrap();
    r.commit("base").await.unwrap();

    // One hunk: -b +B, -c +C, +new
    write(&root, "f.txt", "a\nB\nC\nnew\nd\n");
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
    let h = &d.hunks[0];
    let idx = |kind: LineKind, text: &str| {
        h.lines
            .iter()
            .position(|l| l.kind == kind && l.content == text)
            .unwrap() as u32
    };
    // Stage only "-b" and "+B".
    r.apply_lines(
        "f.txt",
        &h.header,
        &[idx(LineKind::Del, "b"), idx(LineKind::Add, "B")],
        false,
    )
    .await
    .unwrap();
    let index = g.read(&root, ["show", ":f.txt"]).await.unwrap();
    assert_eq!(index, "a\nB\nc\nd\n");
    assert_eq!(
        std::fs::read_to_string(root.join("f.txt")).unwrap(),
        "a\nB\nC\nnew\nd\n",
        "working file untouched"
    );

    // Stage just the "+new" addition.
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    let h = &d.hunks[0];
    let new_i = h.lines.iter().position(|l| l.content == "new").unwrap() as u32;
    r.apply_lines("f.txt", &h.header, &[new_i], false)
        .await
        .unwrap();
    assert_eq!(
        g.read(&root, ["show", ":f.txt"]).await.unwrap(),
        "a\nB\nc\nnew\nd\n"
    );

    // Unstage the "-b/+B" pair again from the staged diff.
    let s = r.file_diff("f.txt", Area::Staged, None).await.unwrap();
    let h = &s.hunks[0];
    let sel: Vec<u32> = h
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| {
            (l.kind == LineKind::Del && l.content == "b")
                || (l.kind == LineKind::Add && l.content == "B")
        })
        .map(|(i, _)| i as u32)
        .collect();
    assert_eq!(sel.len(), 2);
    r.apply_lines("f.txt", &h.header, &sel, true).await.unwrap();
    assert_eq!(
        g.read(&root, ["show", ":f.txt"]).await.unwrap(),
        "a\nb\nc\nnew\nd\n"
    );
}

#[tokio::test]
async fn revert_cherry_pick_merge() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "a.txt", "1\n");
    r.stage_all().await.unwrap();
    r.commit("one").await.unwrap();
    write(&root, "b.txt", "b\n");
    r.stage_all().await.unwrap();
    let bad = r.commit("add b").await.unwrap();

    r.revert(&bad).await.unwrap();
    assert!(!root.join("b.txt").exists());
    let top = r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 1,
            search: None,
            path: None,
        })
        .await
        .unwrap();
    assert!(top.commits[0].subject.starts_with("Revert \"add b\""));

    r.branch_create("topic", None, true).await.unwrap();
    write(&root, "t.txt", "t\n");
    r.stage_all().await.unwrap();
    let pick = r.commit("topic work").await.unwrap();
    write(&root, "u.txt", "u\n");
    r.stage_all().await.unwrap();
    r.commit("more topic work").await.unwrap();
    r.branch_switch("main").await.unwrap();

    r.cherry_pick(&pick).await.unwrap();
    assert!(root.join("t.txt").exists() && !root.join("u.txt").exists());

    r.merge("topic").await.unwrap();
    assert!(root.join("u.txt").exists());
    assert_eq!(r.status().await.unwrap().state, RepoState::Normal);
}

#[tokio::test]
async fn rebase_conflict_then_abort_or_continue() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "c.txt", "base\n");
    r.stage_all().await.unwrap();
    r.commit("base").await.unwrap();
    r.branch_create("feature", None, true).await.unwrap();
    write(&root, "c.txt", "feature\n");
    r.stage_all().await.unwrap();
    r.commit("feature change").await.unwrap();
    r.branch_switch("main").await.unwrap();
    write(&root, "c.txt", "main\n");
    r.stage_all().await.unwrap();
    r.commit("main change").await.unwrap();
    r.branch_switch("feature").await.unwrap();

    // Conflict → paused rebase; abort restores the branch exactly.
    let before = g.read(&root, ["rev-parse", "HEAD"]).await.unwrap();
    assert_eq!(
        r.rebase("main").await.unwrap_err().kind,
        ErrorKind::Conflict
    );
    assert_eq!(r.status().await.unwrap().state, RepoState::Rebasing);
    r.sequence(SequenceAction::Abort).await.unwrap();
    assert_eq!(r.status().await.unwrap().state, RepoState::Normal);
    assert_eq!(g.read(&root, ["rev-parse", "HEAD"]).await.unwrap(), before);

    // Again, resolve, continue (no editor opens), and the branch now sits on top of main.
    assert!(r.rebase("main").await.is_err());
    // Continuing with unresolved conflicts is refused.
    assert!(r.sequence(SequenceAction::Continue).await.is_err());
    write(&root, "c.txt", "resolved\n");
    r.stage(&["c.txt".into()]).await.unwrap();
    r.sequence(SequenceAction::Continue).await.unwrap();
    let st = r.status().await.unwrap();
    assert_eq!(st.state, RepoState::Normal);
    assert_eq!(st.branch.head.as_deref(), Some("feature"));
    let log = r
        .log(&LogQuery {
            rev: None,
            skip: 0,
            limit: 3,
            search: None,
            path: None,
        })
        .await
        .unwrap();
    let subjects: Vec<_> = log.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, vec!["feature change", "main change", "base"]);
    assert!(
        r.sequence(SequenceAction::Continue).await.is_err(),
        "nothing in progress"
    );
}

#[tokio::test]
async fn cancelled_clone_leaves_nothing_behind() {
    let g = git();
    let (_d1, src) = new_repo(&g).await;
    let rs = Repo {
        git: &g,
        path: &src,
    };
    write(&src, "x.txt", "x\n");
    rs.stage_all().await.unwrap();
    rs.commit("x").await.unwrap();

    let parent = tempfile::tempdir().unwrap();
    let dest = parent.path().join("copy");
    let cancel = tokio::sync::Notify::new();
    cancel.notify_one(); // cancel immediately
    let url = format!("file://{}", src.display());
    let err = repo::clone(&g, &url, &dest, Some(&cancel), |_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Cancelled);
    assert!(!dest.exists(), "partial clone removed");

    // A pre-existing empty destination folder is kept (only its contents are removed).
    std::fs::create_dir(&dest).unwrap();
    let cancel = tokio::sync::Notify::new();
    cancel.notify_one();
    assert!(repo::clone(&g, &url, &dest, Some(&cancel), |_| {})
        .await
        .is_err());
    assert!(dest.exists() && std::fs::read_dir(&dest).unwrap().next().is_none());

    // Without cancellation it works.
    repo::clone(&g, &url, &dest, None, |_| {}).await.unwrap();
    assert!(dest.join("x.txt").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_hanging_fetch_stops_git_and_its_helpers() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let marker = format!("gp-cancel-probe-{}", std::process::id());
    // A fake ssh that never answers. The marker in its argv lets us find it afterwards.
    let script = root.join(".git").join("fake-ssh.sh");
    // Copy `sleep` under a unique name so the helper can be found by its process name.
    let sleeper = root.join(".git").join(&marker);
    std::fs::copy(which_sleep(), &sleeper).unwrap();
    std::fs::write(
        &script,
        format!("#!/bin/sh\nexec {} 300\n", sleeper.display()),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    g.run(
        &root,
        ["config", "core.sshCommand", script.to_str().unwrap()],
        Default::default(),
    )
    .await
    .unwrap();
    r.remote_add("slow", "ssh://git@slow.invalid/x.git")
        .await
        .unwrap();

    let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        c2.notify_one();
    });
    let started = std::time::Instant::now();
    let err = r
        .fetch(Some("slow"), Some(&cancel), |_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Cancelled);
    assert!(started.elapsed() < std::time::Duration::from_secs(10));

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let ps = std::process::Command::new("ps")
        .args(["-eo", "args"])
        .output()
        .unwrap();
    let leftover = String::from_utf8_lossy(&ps.stdout)
        .lines()
        .any(|l| l.contains(&marker));
    assert!(!leftover, "ssh helper was left running");
}

#[cfg(unix)]
fn which_sleep() -> std::path::PathBuf {
    ["/usr/bin/sleep", "/bin/sleep"]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.exists())
        .expect("sleep binary")
}

/// The 0.2.0 dead end: a local branch that was never linked to `origin/main`, with unrelated history.
#[tokio::test]
async fn unlinked_branch_with_unrelated_history_can_be_pulled_and_linked() {
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

    // "web upload" side
    let (_w, web) = new_repo(&g).await;
    let rw = Repo {
        git: &g,
        path: &web,
    };
    write(&web, "README.md", "from web\n");
    rw.stage_all().await.unwrap();
    rw.commit("Add files via upload").await.unwrap();
    rw.remote_add("origin", &url).await.unwrap();
    rw.push(None, false, false, None, |_| {}).await.unwrap();

    // local folder started separately, remote added later, fetched, never linked
    let (_l, local) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &local,
    };
    write(&local, "app.txt", "local\n");
    r.stage_all().await.unwrap();
    r.commit("Initial from zip").await.unwrap();
    r.remote_add("origin", &url).await.unwrap();
    r.fetch(None, None, |_| {}).await.unwrap();

    let st = r.status().await.unwrap();
    assert!(st.branch.upstream.is_none());
    let twin = st.remote_twin.expect("origin/main detected");
    assert_eq!(twin.name, "origin/main");
    assert_eq!((twin.ahead, twin.behind, twin.unrelated), (1, 1, true));

    // Publishing is rejected (remote has other commits).
    assert_eq!(
        r.push(None, false, false, None, |_| {})
            .await
            .unwrap_err()
            .kind,
        ErrorKind::PushRejected
    );

    // A normal pull explains the unrelated histories instead of failing vaguely.
    let none = PullOptions {
        strategy: None,
        allow_unrelated: false,
    };
    let err = r
        .pull(PullStrategy::FfOnly, none, |_| {})
        .await
        .unwrap_err();
    assert_eq!(
        err.kind,
        ErrorKind::UnrelatedHistories,
        "ff-only pull should name the real problem"
    );
    let err = r.pull(PullStrategy::Merge, none, |_| {}).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::UnrelatedHistories);

    // Combining explicitly works, links the branch, and then push succeeds.
    let combine = PullOptions {
        strategy: Some(PullStrategy::Merge),
        allow_unrelated: true,
    };
    r.pull(PullStrategy::FfOnly, combine, |_| {}).await.unwrap();
    assert!(local.join("README.md").exists() && local.join("app.txt").exists());
    let st = r.status().await.unwrap();
    assert_eq!(st.branch.upstream.as_deref(), Some("origin/main"));
    assert!(st.remote_twin.is_none());
    r.push(None, false, false, None, |_| {}).await.unwrap();
    assert_eq!(r.status().await.unwrap().branch.ahead, Some(0));
}

#[tokio::test]
async fn diverged_pull_reports_choice_and_merge_override_works() {
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
    let (_a, a) = new_repo(&g).await;
    let ra = Repo { git: &g, path: &a };
    write(&a, "x.txt", "1\n");
    ra.stage_all().await.unwrap();
    ra.commit("one").await.unwrap();
    ra.remote_add("origin", &url).await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    let parent = tempfile::tempdir().unwrap();
    let b = repo::clone(&g, &url, &parent.path().join("b"), None, |_| {})
        .await
        .unwrap();
    let rb = Repo { git: &g, path: &b };
    write(&a, "a.txt", "a\n");
    ra.stage_all().await.unwrap();
    ra.commit("from a").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    write(&b, "b.txt", "b\n");
    rb.stage_all().await.unwrap();
    rb.commit("from b").await.unwrap();

    let none = PullOptions {
        strategy: None,
        allow_unrelated: false,
    };
    assert_eq!(
        rb.pull(PullStrategy::FfOnly, none, |_| {})
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Diverged
    );
    let merge = PullOptions {
        strategy: Some(PullStrategy::Merge),
        allow_unrelated: false,
    };
    rb.pull(PullStrategy::FfOnly, merge, |_| {}).await.unwrap();
    assert!(b.join("a.txt").exists() && b.join("b.txt").exists());
}

/// A Windows editor saving an LF file with CRLF would make GitHub show every line changed
/// (and PR suggestions fail with "context doesn't match"). GitPilot flags it and fixes it.
#[tokio::test]
async fn line_ending_guard_detects_and_fixes_crlf() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    // Make sure local config can't convert line endings behind our back.
    g.run(
        &root,
        ["config", "core.autocrlf", "false"],
        Default::default(),
    )
    .await
    .unwrap();
    write(&root, "src/app.ts", "const a = 1;\nconst b = 2;\n");
    write(&root, "tools/run.bat", "@echo off\r\necho hi\r\n");
    write(&root, ".gitattributes", "*.bat eol=crlf\n");
    r.stage(&[
        "src/app.ts".into(),
        "tools/run.bat".into(),
        ".gitattributes".into(),
    ])
    .await
    .unwrap();
    r.commit("Initial").await.unwrap();

    // Same content, CRLF endings + a new CRLF file + an LF change that must not be flagged.
    write(&root, "src/app.ts", "const a = 1;\r\nconst b = 2;\r\n");
    write(&root, "src/new.ts", "export {};\r\n");
    write(&root, "README.md", "# ok\n");
    write(&root, "tools/run.bat", "@echo off\r\necho bye\r\n");
    r.stage(&[
        "src/app.ts".into(),
        "src/new.ts".into(),
        "README.md".into(),
        "tools/run.bat".into(),
    ])
    .await
    .unwrap();

    let report = r.eol_check().await.unwrap();
    let mut flagged: Vec<(&str, gitpilot_lib::git::eol::EolKind)> = report
        .issues
        .iter()
        .map(|i| (i.path.as_str(), i.kind))
        .collect();
    flagged.sort_by_key(|f| f.0);
    use gitpilot_lib::git::eol::EolKind;
    assert_eq!(
        flagged,
        vec![
            ("src/app.ts", EolKind::LineEndingsOnly),
            ("src/new.ts", EolKind::CrlfIntroduced)
        ],
        "the .bat file is meant to keep CRLF and README uses LF"
    );
    assert!(!report.has_text_rule);
    assert_eq!(report.autocrlf.as_deref(), Some("false"));

    let backups = tempfile::tempdir().unwrap();
    let paths: Vec<String> = report.issues.iter().map(|i| i.path.clone()).collect();
    assert_eq!(r.eol_fix(&paths, backups.path()).await.unwrap(), 2);

    // Index and working copy are LF now; app.ts has no change left at all.
    assert!(r.eol_check().await.unwrap().issues.is_empty());
    assert_eq!(
        std::fs::read_to_string(root.join("src/app.ts")).unwrap(),
        "const a = 1;\nconst b = 2;\n"
    );
    let st = r.status().await.unwrap();
    assert!(
        !st.files.iter().any(|f| f.path == "src/app.ts"),
        "a line-endings-only change disappears once fixed"
    );
    assert!(st
        .files
        .iter()
        .any(|f| f.path == "src/new.ts" && f.area == Area::Staged));
    // The original CRLF copy was backed up.
    let saved = walk(backups.path());
    assert!(saved.iter().any(|p| p.ends_with("src/app.ts")));

    // .gitattributes: the catch-all rule goes first so `*.bat eol=crlf` still wins.
    assert!(r.eol_add_gitattributes().await.unwrap());
    let ga = std::fs::read_to_string(root.join(".gitattributes")).unwrap();
    let rule = ga.find("* text=auto").unwrap();
    assert!(rule < ga.find("*.bat eol=crlf").unwrap());
    assert!(!r.eol_add_gitattributes().await.unwrap(), "added only once");
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}
