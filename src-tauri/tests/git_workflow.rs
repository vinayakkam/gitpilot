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
            // Local-path submodules are blocked by default; the submodule test needs them.
            "[user]\n\tname = Test User\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[protocol \"file\"]\n\tallow = always\n",
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
            path: None,
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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
    let tip = r
        .branches()
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.name == "feature/y")
        .unwrap()
        .tip;
    r.branch_delete("feature/y", true).await.unwrap();
    assert!(!r
        .branches()
        .await
        .unwrap()
        .iter()
        .any(|b| b.name.starts_with("feature/")));
    // A force delete keeps the tip as a backup, so the branch can be recovered.
    let backups = r.backups().await.unwrap();
    assert_eq!(backups[0].label, "deleted branch feature/y");
    assert_eq!(backups[0].hash, tip);

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
            ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
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

/// Files committed before a .gitignore rule keep showing up as changes. GitPilot marks them,
/// can stop tracking them (keeping them on disk) and can add new ignore rules.
#[tokio::test]
async fn gitignore_tracked_files_and_ignore_rules() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "src/main.rs", "fn main() {}\n");
    write(&root, "build/out.txt", "v1\n");
    r.stage_all().await.unwrap();
    r.commit("Initial").await.unwrap();

    // The build folder is ignored only after it was committed, and then changes.
    write(&root, ".gitignore", "build/\n");
    write(&root, "build/out.txt", "v2\n");
    write(&root, "debug.log", "noise\n");
    let st = r.status().await.unwrap();
    let out = st.files.iter().find(|f| f.path == "build/out.txt").unwrap();
    assert!(out.ignored, "tracked file matching .gitignore is flagged");
    assert!(!st.files.iter().any(|f| f.path == ".gitignore" && f.ignored));
    assert!(st
        .files
        .iter()
        .any(|f| f.path == "debug.log" && f.area == Area::Untracked));

    // Ignore a new pattern: the untracked log disappears; duplicates aren't added twice.
    let added = r
        .ignore_add(&["*.log".into(), "build/".into(), " *.log ".into()])
        .await
        .unwrap();
    assert_eq!(added, vec!["*.log".to_string()]);
    assert_eq!(
        std::fs::read_to_string(root.join(".gitignore")).unwrap(),
        "build/\n*.log\n"
    );
    let st = r.status().await.unwrap();
    assert!(!st.files.iter().any(|f| f.path == "debug.log"));
    assert!(r.ignore_add(&["a\nb".into()]).await.is_err());
    // Ignoring without untracking anything (the common case) must not fail.
    r.untrack(&[]).await.unwrap();

    // Stop tracking: staged deletion, file still on disk, no longer flagged.
    r.untrack(&["build".into()]).await.unwrap();
    assert!(root.join("build/out.txt").exists());
    let st = r.status().await.unwrap();
    let gone = st.files.iter().find(|f| f.path == "build/out.txt").unwrap();
    assert_eq!(gone.area, Area::Staged);
    assert_eq!(gone.change, ChangeType::Deleted);
    assert!(!gone.ignored);
    r.stage(&[".gitignore".into()]).await.unwrap();
    r.commit("Stop tracking build output").await.unwrap();
    assert!(
        r.status().await.unwrap().files.is_empty(),
        "nothing left to show"
    );
}

/// Batch A (0.4.0): amend, undo last commit, tags, stashing selected files and discarding
/// lines or hunks from the working copy.
#[tokio::test]
async fn amend_undo_tags_stash_paths_and_partial_discard() {
    let g = git();
    let bare = tempfile::tempdir().unwrap();
    g.run(
        bare.path(),
        ["init", "--bare", "-b", "main"],
        Default::default(),
    )
    .await
    .unwrap();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    assert!(r.last_commit().await.unwrap().is_none());
    write(&root, "f.txt", "a\nb\nc\nd\n");
    r.stage_all().await.unwrap();
    r.commit("Base").await.unwrap();
    let base = r.last_commit().await.unwrap().unwrap();
    assert!(base.is_root && !base.pushed);

    // Amend: message only, then with an extra staged file.
    r.commit_with("Base commit\n\nWith a body.", true)
        .await
        .unwrap();
    write(&root, "extra.txt", "x\n");
    r.stage(&["extra.txt".into()]).await.unwrap();
    let h = r.commit_with("Base commit", true).await.unwrap();
    let count = g
        .read(&root, ["rev-list", "--count", "HEAD"])
        .await
        .unwrap();
    assert_eq!(count.trim(), "1", "amend replaces, never adds");
    let files = g
        .read(&root, ["show", "--name-only", "--format=", &h])
        .await
        .unwrap();
    assert!(files.contains("extra.txt"));

    // Undo a normal commit: changes return staged, message comes back.
    write(&root, "g.txt", "g\n");
    r.stage(&["g.txt".into()]).await.unwrap();
    r.commit("Add g").await.unwrap();
    let msg = r.undo_last_commit(false).await.unwrap();
    assert_eq!(msg, "Add g");
    let st = r.status().await.unwrap();
    assert!(st
        .files
        .iter()
        .any(|f| f.path == "g.txt" && f.area == Area::Staged));
    r.commit("Add g").await.unwrap();

    // Pushed commits need confirmation to undo.
    let url = bare.path().display().to_string();
    r.remote_add("origin", &url).await.unwrap();
    r.push(None, false, false, None, |_| {}).await.unwrap();
    assert!(r.last_commit().await.unwrap().unwrap().pushed);
    assert!(r.undo_last_commit(false).await.is_err());

    // Tags: lightweight + annotated, push, delete remote, delete local.
    r.tag_create("v1.0", "HEAD", "First release").await.unwrap();
    r.tag_create("light", "HEAD~1", "").await.unwrap();
    assert!(
        r.tag_create("v1.0", "HEAD", "").await.is_err(),
        "no duplicates"
    );
    assert!(r.tag_create("bad name", "HEAD", "").await.is_err());
    let tags = r.tags().await.unwrap();
    let v1 = tags.iter().find(|t| t.name == "v1.0").unwrap();
    assert!(v1.annotated);
    assert_eq!(v1.message, "First release");
    let head = g.read(&root, ["rev-parse", "HEAD"]).await.unwrap();
    assert_eq!(v1.target, head.trim());
    r.tag_push("origin", "v1.0", false).await.unwrap();
    let remote_tags = g.read(bare.path(), ["tag"]).await.unwrap();
    assert!(remote_tags.contains("v1.0"));
    r.tag_push("origin", "v1.0", true).await.unwrap();
    assert!(!g.read(bare.path(), ["tag"]).await.unwrap().contains("v1.0"));
    r.tag_delete("light").await.unwrap();
    assert_eq!(r.tags().await.unwrap().len(), 1);

    // Stash only one of two changed files.
    write(&root, "f.txt", "a\nb\nc\nd\ne\n");
    write(&root, "g.txt", "changed\n");
    r.stash_push_paths("only g", false, &["g.txt".into()])
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(root.join("g.txt")).unwrap(), "g\n");
    assert_eq!(
        std::fs::read_to_string(root.join("f.txt")).unwrap(),
        "a\nb\nc\nd\ne\n",
        "other file untouched"
    );
    assert_eq!(r.stash_list().await.unwrap()[0].message, "On main: only g");

    // Discard lines: f.txt has -b +B, -c +C, +new. Discard only the B replacement.
    write(&root, "f.txt", "a\nB\nC\nnew\nd\n");
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    let h = &d.hunks[0];
    let idx = |kind: LineKind, text: &str| {
        h.lines
            .iter()
            .position(|l| l.kind == kind && l.content == text)
            .unwrap() as u32
    };
    let backups = tempfile::tempdir().unwrap();
    let saved = r
        .discard_partial(
            "f.txt",
            &h.header,
            Some(&[idx(LineKind::Del, "b"), idx(LineKind::Add, "B")]),
            backups.path(),
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("f.txt")).unwrap(),
        "a\nb\nC\nnew\nd\n",
        "only the selected change was reverted"
    );
    assert!(saved.is_some());

    // Discard the "+new" addition alone, then the rest of the hunk.
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    let h = &d.hunks[0];
    let new_i = h.lines.iter().position(|l| l.content == "new").unwrap() as u32;
    r.discard_partial("f.txt", &h.header, Some(&[new_i]), backups.path())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("f.txt")).unwrap(),
        "a\nb\nC\nd\n"
    );
    let d = r.file_diff("f.txt", Area::Unstaged, None).await.unwrap();
    r.discard_partial("f.txt", &d.hunks[0].header, None, backups.path())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("f.txt")).unwrap(),
        "a\nb\nc\nd\n"
    );
    assert!(r.status().await.unwrap().files.is_empty());
}

/// Batch B (0.4.0): blame, comparing revisions file by file, and image previews.
#[tokio::test]
async fn blame_compare_and_image_previews() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "f.txt", "one\ntwo\n");
    // A tiny valid PNG (1x1).
    let png: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0,
        0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44,
        0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 0x05, 0x00, 0x01, 0xff,
        0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    std::fs::write(root.join("logo.png"), png).unwrap();
    r.stage_all().await.unwrap();
    r.commit("First").await.unwrap();
    let first = g
        .read(&root, ["rev-parse", "HEAD"])
        .await
        .unwrap()
        .trim()
        .to_string();
    r.branch_create("feature", None, true).await.unwrap();
    write(&root, "f.txt", "one\nTWO\nthree\n");
    let mut png2 = png.to_vec();
    png2.extend_from_slice(b"extra");
    std::fs::write(root.join("logo.png"), &png2).unwrap();
    r.stage_all().await.unwrap();
    r.commit("Second").await.unwrap();

    // Blame: line 1 from First, lines 2-3 from Second; an uncommitted edit shows up as such.
    write(&root, "f.txt", "one\nTWO\nthree\nfour\n");
    let b = r.blame("f.txt", None).await.unwrap();
    assert_eq!(b.lines.len(), 4);
    let who = |i: usize| &b.commits[b.lines[i].commit as usize];
    assert_eq!(who(0).summary, "First");
    assert_eq!(who(1).summary, "Second");
    assert!(who(3).uncommitted);
    let at_first = r.blame("f.txt", Some(&first)).await.unwrap();
    assert_eq!(at_first.lines.len(), 2);

    // Compare main...feature: both files changed.
    let files = r.compare_files("main", "feature", true).await.unwrap();
    let mut names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    names.sort();
    assert_eq!(names, vec!["f.txt", "logo.png"]);
    let d = r
        .compare_file_diff("main", "feature", true, "f.txt", None)
        .await
        .unwrap();
    assert_eq!((d.additions, d.deletions), (2, 1));
    assert!(!d.hunk_actions);
    assert!(r.compare_files("main", "bad name", true).await.is_err());

    // Image previews: in a commit, in a comparison and in the working copy.
    let head = g
        .read(&root, ["rev-parse", "HEAD"])
        .await
        .unwrap()
        .trim()
        .to_string();
    let c = r.commit_file_diff(&head, "logo.png", None).await.unwrap();
    let img = c.image.expect("commit image preview");
    assert!(img.old.unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(img.new_size, Some(png2.len() as u64));
    let cmp = r
        .compare_file_diff("main", "feature", true, "logo.png", None)
        .await
        .unwrap();
    assert!(cmp.image.is_some());
    std::fs::write(root.join("logo.png"), png).unwrap();
    let wt = r.file_diff("logo.png", Area::Unstaged, None).await.unwrap();
    let img = wt.image.expect("working copy image preview");
    assert_eq!(img.old_size, Some(png2.len() as u64));
    assert_eq!(img.new_size, Some(png.len() as u64));
}

/// Batch C (0.4.0): resolving conflict blocks, editing commits (interactive rebase), and
/// resetting with an automatic backup that can be restored.
#[tokio::test]
async fn conflicts_interactive_rebase_and_reset_backups() {
    use gitpilot_lib::git::rewrite::{ConflictChoice, RebaseAction, RebaseStep, ResetMode};
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let log = |g: &Git, root: &Path| {
        let g = g.clone();
        let root = root.to_path_buf();
        async move {
            g.read(&root, ["log", "--format=%s", "--reverse"])
                .await
                .unwrap()
                .lines()
                .map(String::from)
                .collect::<Vec<_>>()
        }
    };

    // --- conflicts ---
    write(
        &root,
        "c.txt",
        "top\nm1\nm2\nm3\nm4\nm5\nm6\nm7\nm8\nbottom\nend\n",
    );
    r.stage_all().await.unwrap();
    r.commit("Base").await.unwrap();
    r.branch_create("other", None, true).await.unwrap();
    write(
        &root,
        "c.txt",
        "TOP-other\nm1\nm2\nm3\nm4\nm5\nm6\nm7\nm8\nBOTTOM-other\nend\n",
    );
    r.stage_all().await.unwrap();
    r.commit("Other").await.unwrap();
    r.branch_switch("main").await.unwrap();
    write(
        &root,
        "c.txt",
        "TOP-main\nm1\nm2\nm3\nm4\nm5\nm6\nm7\nm8\nBOTTOM-main\nend\n",
    );
    r.stage_all().await.unwrap();
    r.commit("Main").await.unwrap();
    assert!(r.merge("other").await.is_err(), "conflict stops the merge");
    let left = r
        .conflict_resolve_block("c.txt", 0, ConflictChoice::Incoming)
        .await
        .unwrap();
    assert_eq!(left, 1);
    let left = r
        .conflict_resolve_block("c.txt", 0, ConflictChoice::Both)
        .await
        .unwrap();
    assert_eq!(left, 0);
    assert_eq!(
        std::fs::read_to_string(root.join("c.txt")).unwrap(),
        "TOP-other\nm1\nm2\nm3\nm4\nm5\nm6\nm7\nm8\nBOTTOM-main\nBOTTOM-other\nend\n"
    );
    r.stage(&["c.txt".into()]).await.unwrap();
    r.commit("Merge other").await.unwrap();

    // Whole-file choice.
    r.branch_create("other2", Some("other"), true)
        .await
        .unwrap();
    write(&root, "c.txt", "theirs only\n");
    r.stage_all().await.unwrap();
    r.commit("Other2").await.unwrap();
    r.branch_switch("main").await.unwrap();
    assert!(r.merge("other2").await.is_err());
    r.conflict_take_side("c.txt", true).await.unwrap();
    assert!(!std::fs::read_to_string(root.join("c.txt"))
        .unwrap()
        .contains("<<<<<<<"));
    r.stage(&["c.txt".into()]).await.unwrap();
    r.commit("Keep main's version").await.unwrap();

    // --- interactive rebase on a fresh linear branch ---
    r.branch_create("work", None, true).await.unwrap();
    let base = g
        .read(&root, ["rev-parse", "HEAD"])
        .await
        .unwrap()
        .trim()
        .to_string();
    for (f, m) in [
        ("1.txt", "One"),
        ("2.txt", "Two"),
        ("3.txt", "Three"),
        ("4.txt", "Four"),
    ] {
        write(&root, f, m);
        r.stage(&[f.into()]).await.unwrap();
        r.commit(m).await.unwrap();
    }
    let commits = r.rebase_commits(Some(&base)).await.unwrap();
    assert_eq!(
        commits
            .iter()
            .map(|c| c.subject.as_str())
            .collect::<Vec<_>>(),
        vec!["One", "Two", "Three", "Four"]
    );
    let h = |i: usize| commits[i].hash.clone();
    // New order: Three (reworded), One + Two squashed with a new message, Four dropped.
    let steps = vec![
        RebaseStep {
            hash: h(2),
            action: RebaseAction::Reword,
            message: Some("Three, reworded\n\nWith a body.".into()),
        },
        RebaseStep {
            hash: h(0),
            action: RebaseAction::Pick,
            message: None,
        },
        RebaseStep {
            hash: h(1),
            action: RebaseAction::Squash,
            message: Some("One and two".into()),
        },
        RebaseStep {
            hash: h(3),
            action: RebaseAction::Drop,
            message: None,
        },
    ];
    // A stale list (missing a commit) is refused.
    assert!(r
        .rebase_interactive(Some(&base), &steps[..3], false)
        .await
        .is_err());
    let backup = r
        .rebase_interactive(Some(&base), &steps, false)
        .await
        .unwrap();
    let after = log(&g, &root).await;
    assert_eq!(
        &after[after.len() - 2..],
        &["Three, reworded", "One and two"]
    );
    assert!(
        !root.join("4.txt").exists(),
        "dropped commit's file is gone"
    );
    assert!(root.join("1.txt").exists() && root.join("2.txt").exists());
    let body = g
        .read(&root, ["log", "-1", "--skip=1", "--format=%B"])
        .await
        .unwrap();
    assert!(body.contains("With a body."));

    // --- backups and reset ---
    let backups = r.backups().await.unwrap();
    assert!(backups
        .iter()
        .any(|b| b.name == backup.name && b.label.contains("editing commits")));
    write(&root, "1.txt", "uncommitted work");
    let b2 = r.reset_to(&base, ResetMode::Hard).await.unwrap();
    assert!(b2.wip.is_some(), "uncommitted changes were saved");
    assert!(!root.join("1.txt").exists());
    r.backup_restore(&b2.name).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("1.txt")).unwrap(),
        "uncommitted work",
        "restoring brings back commits and uncommitted work"
    );
    assert_eq!(log(&g, &root).await.last().unwrap(), "One and two");

    // Soft reset keeps the changes staged.
    r.stage(&["1.txt".into()]).await.unwrap();
    r.commit("Edit one").await.unwrap();
    r.reset_to("HEAD~1", ResetMode::Soft).await.unwrap();
    let st = r.status().await.unwrap();
    assert!(st
        .files
        .iter()
        .any(|f| f.path == "1.txt" && f.area == Area::Staged));
    r.backup_delete(&b2.name).await.unwrap();
    assert!(!r.backups().await.unwrap().iter().any(|b| b.name == b2.name));
    assert!(
        r.backup_delete("refs/heads/main").await.is_err(),
        "only GitPilot backups"
    );
}

#[tokio::test]
async fn ai_inputs_and_applying_a_conflict_suggestion() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "c.txt", "top\nmiddle\nbottom\n");
    r.stage_all().await.unwrap();
    r.commit("Base").await.unwrap();

    // Branch changes for a pull request description: commits oldest first, diff since the split.
    r.branch_create("feature", None, true).await.unwrap();
    write(&root, "c.txt", "TOP-feature\nmiddle\nbottom\n");
    r.stage_all().await.unwrap();
    r.commit("Change top\n\nBecause the old one was wrong.")
        .await
        .unwrap();
    write(&root, "new.txt", "hello\n");
    r.stage_all().await.unwrap();
    let hash = r.commit("Add new file").await.unwrap();
    let (commits, diff) = r.branch_changes_since("main").await.unwrap();
    assert_eq!(
        commits,
        "- Change top\n  Because the old one was wrong.\n- Add new file\n"
    );
    let diff = String::from_utf8(diff).unwrap();
    assert!(diff.contains("+TOP-feature") && diff.contains("+hello"));
    assert!(r.branch_changes_since("--upload-pack=x").await.is_err());
    let missing = r.branch_changes_since("origin/main").await.unwrap_err();
    assert!(missing.message.contains("Fetch"), "{}", missing.message);

    let one = String::from_utf8(r.commit_diff_raw(&hash).await.unwrap()).unwrap();
    assert!(one.contains("diff --git a/new.txt b/new.txt") && !one.contains("TOP-feature"));

    // One file's changes, including a new untracked file.
    write(&root, "c.txt", "TOP-feature\nmiddle!\nbottom\n");
    write(&root, "untracked.txt", "u1\nu2\n");
    let d = r
        .change_diff_raw("c.txt", Area::Unstaged, None)
        .await
        .unwrap();
    assert!(String::from_utf8(d).unwrap().contains("+middle!"));
    let d = r
        .change_diff_raw("untracked.txt", Area::Untracked, None)
        .await
        .unwrap();
    assert!(String::from_utf8(d)
        .unwrap()
        .ends_with("+++ b/untracked.txt\n+u1\n+u2\n"));
    assert!(r
        .change_diff_raw("../x", Area::Unstaged, None)
        .await
        .is_err());
    std::fs::remove_file(root.join("untracked.txt")).unwrap();
    let backups = tempfile::tempdir().unwrap();
    r.discard_tracked(&["c.txt".into()], backups.path())
        .await
        .unwrap();

    // A conflict, resolved with a suggested text.
    r.branch_switch("main").await.unwrap();
    write(&root, "c.txt", "TOP-main\nmiddle\nbottom\n");
    r.stage_all().await.unwrap();
    r.commit("Main top").await.unwrap();
    assert!(
        r.merge("feature").await.is_err(),
        "conflict stops the merge"
    );
    let blocks = r.conflict_blocks("c.txt").await.unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].ours, "TOP-main\n");
    assert_eq!(blocks[0].theirs, "TOP-feature\n");
    assert_eq!(blocks[0].after, "middle\nbottom\n");

    // A stale block is refused and the file is left alone.
    let before = std::fs::read_to_string(root.join("c.txt")).unwrap();
    assert!(r
        .conflict_apply_text("c.txt", 0, "<<<<<<< HEAD\nold\n", "x")
        .await
        .is_err());
    assert_eq!(std::fs::read_to_string(root.join("c.txt")).unwrap(), before);

    let left = r
        .conflict_apply_text("c.txt", 0, &blocks[0].raw, "TOP-merged")
        .await
        .unwrap();
    assert_eq!(left, 0);
    assert_eq!(
        std::fs::read_to_string(root.join("c.txt")).unwrap(),
        "TOP-merged\nmiddle\nbottom\n"
    );
}

#[tokio::test]
async fn pull_requests_are_checked_out_without_losing_local_commits() {
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

    // "GitHub": an author pushes main, a branch, and a fork's pull request head.
    let (_d1, a) = new_repo(&g).await;
    let ra = Repo { git: &g, path: &a };
    ra.remote_add("origin", &url).await.unwrap();
    write(&a, "x.txt", "1\n");
    ra.stage_all().await.unwrap();
    ra.commit("one").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    ra.branch_create("feature", None, true).await.unwrap();
    write(&a, "f.txt", "feature\n");
    ra.stage_all().await.unwrap();
    ra.commit("feature work").await.unwrap();
    ra.push(None, true, false, None, |_| {}).await.unwrap();
    ra.branch_create("fork-work", Some("main"), true)
        .await
        .unwrap();
    write(&a, "p.txt", "from a fork\n");
    ra.stage_all().await.unwrap();
    let pr1 = ra.commit("fork change").await.unwrap();
    g.run(
        &a,
        ["push", "origin", "HEAD:refs/pull/1/head"],
        Default::default(),
    )
    .await
    .unwrap();

    // A reviewer's clone.
    let parent = tempfile::tempdir().unwrap();
    let b = repo::clone(&g, &url, &parent.path().join("review"), None, |_| {})
        .await
        .unwrap();
    let rb = Repo { git: &g, path: &b };
    let head = |g: &Git, b: &Path| {
        let (g, b) = (g.clone(), b.to_path_buf());
        async move {
            g.read(&b, ["rev-parse", "HEAD"])
                .await
                .unwrap()
                .trim()
                .to_string()
        }
    };

    // Same-repository pull request: the real branch, tracking the remote.
    let c = rb
        .checkout_pull_branch("origin", "feature", None, |_| {})
        .await
        .unwrap();
    assert_eq!((c.branch.as_str(), c.created), ("feature", true));
    let st = rb.status().await.unwrap();
    assert_eq!(st.branch.head.as_deref(), Some("feature"));
    assert_eq!(st.branch.upstream.as_deref(), Some("origin/feature"));
    rb.branch_switch("main").await.unwrap();
    let again = rb
        .checkout_pull_branch("origin", "feature", None, |_| {})
        .await
        .unwrap();
    assert!(!again.created && !again.updated && !again.diverged);

    // Fork pull request: fetched from refs/pull/1/head into pr-1.
    let c = rb
        .checkout_pull_head("origin", 1, None, |_| {})
        .await
        .unwrap();
    assert_eq!((c.branch.as_str(), c.created), ("pr-1", true));
    assert_eq!(head(&g, &b).await, pr1);
    assert!(rb
        .checkout_pull_head("--upload-pack=x", 1, None, |_| {})
        .await
        .is_err());
    assert!(rb
        .checkout_pull_head("origin", 99, None, |_| {})
        .await
        .is_err());

    // The author pushes more: checking out again fast-forwards pr-1 (also when not on it).
    write(&a, "p.txt", "from a fork\nmore\n");
    ra.stage_all().await.unwrap();
    let pr1b = ra.commit("more fork work").await.unwrap();
    g.run(
        &a,
        ["push", "origin", "HEAD:refs/pull/1/head"],
        Default::default(),
    )
    .await
    .unwrap();
    rb.branch_switch("main").await.unwrap();
    let c = rb
        .checkout_pull_head("origin", 1, None, |_| {})
        .await
        .unwrap();
    assert!(c.updated && !c.diverged);
    assert_eq!(head(&g, &b).await, pr1b);

    // A local commit on pr-1, then the author force-pushes: pr-1 is left alone.
    write(&b, "mine.txt", "local\n");
    rb.stage_all().await.unwrap();
    let mine = rb.commit("my review fix").await.unwrap();
    g.run(
        &a,
        [
            "push",
            "--force",
            "origin",
            &format!("{pr1}:refs/pull/1/head"),
        ],
        Default::default(),
    )
    .await
    .unwrap();
    let c = rb
        .checkout_pull_head("origin", 1, None, |_| {})
        .await
        .unwrap();
    assert!(c.diverged && !c.updated);
    assert_eq!(head(&g, &b).await, mine, "local commit kept");
}

/// Needs network access: `cargo test -- --ignored live_github`.
#[tokio::test]
#[ignore]
async fn live_github_fork_pull_request_checkout() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    // octocat/Hello-World#1 comes from a fork (unoju/Hello-World).
    let c = r
        .checkout_pull_head(
            "https://github.com/octocat/Hello-World.git",
            1,
            None,
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!((c.branch.as_str(), c.created), ("pr-1", true));
    let st = r.status().await.unwrap();
    assert_eq!(st.branch.head.as_deref(), Some("pr-1"));
    assert_eq!(st.branch.upstream, None);
}

#[tokio::test]
async fn ssh_commit_signing_is_set_up_and_verified() {
    use gitpilot_lib::git::signing::{self, SignatureStatus, SigningFormat, SigningScope};
    let Ok(keygen) = which::which("ssh-keygen") else {
        eprintln!("ssh-keygen not installed; skipping");
        return;
    };
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let keys = tempfile::tempdir().unwrap();
    let key = keys.path().join("id_ed25519");
    let ok = std::process::Command::new(keygen)
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f"])
        .arg(&key)
        .status()
        .unwrap()
        .success();
    assert!(ok);
    let allowed = keys.path().join("data").join("allowed_signers");

    // Only this repository, so the shared test configuration isn't touched.
    signing::enable(
        &g,
        Some(&root),
        SigningScope::Repository,
        SigningFormat::Ssh,
        key.to_str().unwrap(),
        &allowed,
    )
    .await
    .unwrap();
    let cfg = r.signing_config().await.unwrap();
    assert!(cfg.enabled);
    assert_eq!(cfg.scope, Some(SigningScope::Repository));
    assert_eq!(cfg.format, SigningFormat::Ssh);
    assert_eq!(cfg.key.as_deref(), key.to_str());
    assert_eq!(cfg.allowed_signers.as_deref(), allowed.to_str());
    assert!(std::fs::read_to_string(&allowed)
        .unwrap()
        .starts_with("test@example.com ssh-ed25519 "));

    write(&root, "a.txt", "signed\n");
    r.stage_all().await.unwrap();
    let signed = r.commit("Signed commit").await.unwrap();
    let s = r.signature(&signed).await.unwrap();
    assert_eq!(s.status, SignatureStatus::Verified, "{s:?}");
    assert_eq!(s.signer.as_deref(), Some("test@example.com"));

    signing::disable(&g, Some(&root), SigningScope::Repository)
        .await
        .unwrap();
    assert!(!r.signing_config().await.unwrap().enabled);
    write(&root, "a.txt", "plain\n");
    r.stage_all().await.unwrap();
    let plain = r.commit("Plain commit").await.unwrap();
    assert_eq!(
        r.signature(&plain).await.unwrap().status,
        SignatureStatus::NotSigned
    );
    assert!(signing::enable(
        &g,
        Some(&root),
        SigningScope::Repository,
        SigningFormat::Ssh,
        "/missing/key",
        &allowed
    )
    .await
    .is_err());
}

#[tokio::test]
async fn lfs_use_is_detected_with_or_without_git_lfs() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    let st = r.lfs_status(true).await.unwrap();
    assert!(st.patterns.is_empty(), "no LFS yet");

    write(
        &root,
        ".gitattributes",
        "*.psd filter=lfs diff=lfs merge=lfs -text\n* text=auto\n",
    );
    write(&root, "art/.gitattributes", "*.mov filter=lfs -text\n");
    r.stage_all().await.unwrap();
    r.commit("LFS rules").await.unwrap();
    let st = r.lfs_status(true).await.unwrap();
    let pats: Vec<(&str, &str)> = st
        .patterns
        .iter()
        .map(|p| (p.pattern.as_str(), p.file.as_str()))
        .collect();
    assert_eq!(
        pats,
        vec![("*.psd", ".gitattributes"), ("*.mov", "art/.gitattributes")]
    );
    let lfs_installed = which::which("git-lfs").is_ok();
    assert_eq!(st.installed, lfs_installed);
    assert!(r.lfs_track("--help").await.is_err());

    if lfs_installed {
        r.lfs_track("*.bin").await.unwrap();
        let attrs = std::fs::read_to_string(root.join(".gitattributes")).unwrap();
        assert!(attrs.contains("*.bin filter=lfs"));
        r.lfs_untrack("*.bin").await.unwrap();
        let attrs = std::fs::read_to_string(root.join(".gitattributes")).unwrap();
        assert!(!attrs.contains("*.bin"));
    } else {
        let e = r.lfs_track("*.bin").await.unwrap_err();
        assert!(e.message.contains("git-lfs.com"), "{}", e.message);
    }
}

#[tokio::test]
async fn submodules_are_listed_and_updated() {
    use gitpilot_lib::git::submodules::SubmoduleState;
    let g = git();
    // The library a project depends on.
    let (_dl, lib) = new_repo(&g).await;
    let rl = Repo {
        git: &g,
        path: &lib,
    };
    write(&lib, "lib.txt", "v1\n");
    rl.stage_all().await.unwrap();
    rl.commit("lib v1").await.unwrap();

    // The project, with the library as a submodule.
    let (_dp, proj) = new_repo(&g).await;
    let rp = Repo {
        git: &g,
        path: &proj,
    };
    assert!(rp.submodules().await.unwrap().is_empty());
    g.run(
        &proj,
        [
            "submodule",
            "add",
            "--quiet",
            lib.to_str().unwrap(),
            "deps/lib",
        ],
        Default::default(),
    )
    .await
    .unwrap();
    rp.commit("Add lib").await.unwrap();
    let s = rp.submodules().await.unwrap();
    assert_eq!(s.len(), 1);
    assert_eq!(
        (s[0].path.as_str(), s[0].name.as_deref(), s[0].state),
        ("deps/lib", Some("deps/lib"), SubmoduleState::UpToDate)
    );
    assert_eq!(s[0].url.as_deref(), lib.to_str());

    // A fresh clone doesn't have the submodule's files yet.
    let parent = tempfile::tempdir().unwrap();
    let copy = repo::clone(
        &g,
        proj.to_str().unwrap(),
        &parent.path().join("copy"),
        None,
        |_| {},
    )
    .await
    .unwrap();
    let rc = Repo {
        git: &g,
        path: &copy,
    };
    assert_eq!(
        rc.submodules().await.unwrap()[0].state,
        SubmoduleState::NotInitialized
    );
    assert!(rc
        .submodule_update(&["../escape".into()], None, |_| {})
        .await
        .is_err());
    rc.submodule_update(&[], None, |_| {}).await.unwrap();
    assert_eq!(
        rc.submodules().await.unwrap()[0].state,
        SubmoduleState::UpToDate
    );
    assert_eq!(
        std::fs::read_to_string(copy.join("deps/lib/lib.txt")).unwrap(),
        "v1\n"
    );

    // A different commit checked out inside the submodule.
    g.run(
        &copy.join("deps/lib"),
        ["commit", "--allow-empty", "-q", "-m", "local"],
        Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(
        rc.submodules().await.unwrap()[0].state,
        SubmoduleState::DifferentCommit
    );
    rc.submodule_update(&["deps/lib".into()], None, |_| {})
        .await
        .unwrap();
    assert_eq!(
        rc.submodules().await.unwrap()[0].state,
        SubmoduleState::UpToDate
    );
}

#[tokio::test]
async fn worktrees_are_added_listed_and_removed_safely() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "a.txt", "1\n");
    r.stage_all().await.unwrap();
    r.commit("one").await.unwrap();
    r.branch_create("fix", None, false).await.unwrap();

    let place = tempfile::tempdir().unwrap();
    let fix_dir = place.path().join("app-fix");
    let added = r
        .worktree_add(fix_dir.to_str().unwrap(), "fix", false, None)
        .await
        .unwrap();
    assert_eq!(added, fix_dir.display().to_string());
    let feat_dir = place.path().join("app-feature");
    r.worktree_add(feat_dir.to_str().unwrap(), "feature", true, Some("HEAD"))
        .await
        .unwrap();

    let list = r.worktrees().await.unwrap();
    assert_eq!(list.len(), 3);
    assert!(list[0].main && list[0].current);
    assert_eq!(list[0].branch.as_deref(), Some("main"));
    let mut branches: Vec<_> = list.iter().filter_map(|w| w.branch.clone()).collect();
    branches.sort();
    assert_eq!(branches, vec!["feature", "fix", "main"]);

    // A branch can only be checked out once.
    let e = r.branch_switch("fix").await.unwrap_err();
    assert!(e.message.contains("another worktree"), "{}", e.message);
    // Folders must be new or empty.
    assert!(r
        .worktree_add(fix_dir.to_str().unwrap(), "main", false, None)
        .await
        .is_err());

    // Uncommitted changes keep a worktree from being removed.
    write(&fix_dir, "a.txt", "changed\n");
    let e = r
        .worktree_remove(fix_dir.to_str().unwrap())
        .await
        .unwrap_err();
    assert_eq!(e.kind, ErrorKind::LocalChangesWouldBeOverwritten, "{e:?}");
    assert!(fix_dir.exists());
    assert!(
        r.worktree_remove(root.to_str().unwrap()).await.is_err(),
        "main"
    );

    r.worktree_remove(feat_dir.to_str().unwrap()).await.unwrap();
    assert!(!feat_dir.exists());

    // A deleted folder shows as prunable until pruned.
    std::fs::remove_dir_all(&fix_dir).unwrap();
    let list = r.worktrees().await.unwrap();
    assert!(list
        .iter()
        .any(|w| w.prunable && w.branch.as_deref() == Some("fix")));
    r.worktree_prune().await.unwrap();
    assert_eq!(r.worktrees().await.unwrap().len(), 1);
}

#[tokio::test]
async fn github_token_reaches_git_for_github_com_only() {
    use gitpilot_lib::git::runner::RunOpts;
    let g = git().with_github_token("tok123");
    let dir = tempfile::tempdir().unwrap();
    let get = |url: &'static str| {
        let g = g.clone();
        let path = dir.path().to_path_buf();
        async move {
            let opts = RunOpts {
                ok_codes: &[1],
                ..RunOpts::read()
            };
            g.run(
                &path,
                ["config", "--get-urlmatch", "http.extraheader", url],
                opts,
            )
            .await
            .unwrap()
            .text()
        }
    };
    // base64("x-access-token:tok123")
    assert_eq!(
        get("https://github.com/o/r.git").await.trim(),
        "Authorization: Basic eC1hY2Nlc3MtdG9rZW46dG9rMTIz"
    );
    assert_eq!(get("https://gitlab.com/o/r.git").await.trim(), "");
    assert_eq!(
        get("https://github.com.evil.example/o/r.git").await.trim(),
        ""
    );
    assert_eq!(get("http://github.com/o/r.git").await.trim(), "");
    assert!(
        !format!("{g:?}").contains("eC1h"),
        "Debug must not show the token"
    );
}

#[tokio::test]
async fn reflog_marks_commits_only_the_reflog_keeps() {
    use gitpilot_lib::git::rewrite::ResetMode;
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    assert!(r.reflog(50).await.unwrap().is_empty(), "no commits yet");
    for (i, msg) in ["one", "two"].iter().enumerate() {
        write(&root, "f.txt", &format!("{i}\n"));
        r.stage_all().await.unwrap();
        r.commit(msg).await.unwrap();
    }
    let two = r.reflog(50).await.unwrap()[0].hash.clone();
    r.reset_to("HEAD~1", ResetMode::Hard).await.unwrap();

    let log = r.reflog(50).await.unwrap();
    assert_eq!(log[0].action, "reset");
    assert!(!log[0].lost, "HEAD's commit is on main");
    let gone = log.iter().find(|e| e.hash == two).unwrap();
    assert_eq!(gone.subject, "two");
    assert_eq!(gone.action, "commit");
    // reset_to keeps a backup ref, which isn't a branch, so the commit still counts as lost.
    assert!(gone.lost);
    assert_eq!(r.reflog(1).await.unwrap().len(), 1);
}

#[tokio::test]
async fn history_search_by_content_and_date() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "a.rs", "fn main() {}\n");
    r.stage_all().await.unwrap();
    r.commit("start").await.unwrap();
    write(&root, "a.rs", "fn main() { let answer = 42; }\n");
    r.stage_all().await.unwrap();
    r.commit("add answer").await.unwrap();
    write(&root, "b.txt", "unrelated\n");
    r.stage_all().await.unwrap();
    r.commit("other").await.unwrap();

    let subjects = |q: LogQuery| {
        let r = &r;
        async move {
            r.log(&q)
                .await
                .map(|p| p.commits.into_iter().map(|c| c.subject).collect::<Vec<_>>())
        }
    };
    let q = |content: &str, regex: bool| LogQuery {
        limit: 50,
        content: Some(content.into()),
        regex,
        ..Default::default()
    };
    assert_eq!(subjects(q("answer", false)).await.unwrap(), ["add answer"]);
    assert_eq!(
        subjects(q("answer = [0-9]+", true)).await.unwrap(),
        ["add answer"]
    );
    assert!(
        subjects(q("Answer", false)).await.unwrap().is_empty(),
        "-S is case-sensitive"
    );
    assert_eq!(
        subjects(q("a(", true)).await.unwrap_err().message,
        "That isn't a valid regular expression."
    );
    assert!(subjects(q("a\nb", false)).await.is_err());

    let all = subjects(LogQuery {
        limit: 50,
        since: Some("2000-01-01".into()),
        ..Default::default()
    })
    .await
    .unwrap();
    assert_eq!(all.len(), 3);
    let none = subjects(LogQuery {
        limit: 50,
        until: Some("2000-01-01".into()),
        ..Default::default()
    })
    .await
    .unwrap();
    assert!(none.is_empty());
    assert!(subjects(LogQuery {
        limit: 50,
        since: Some("yesterday".into()),
        ..Default::default()
    })
    .await
    .is_err());
}

/// Large-repository speed: status for 50 000 changed files. Timing depends on the machine, so
/// it's opt-in: `cargo test --release -- --ignored large_repo_status`.
#[tokio::test]
#[ignore]
async fn large_repo_status_is_fast() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    for i in 0..50_000 {
        write(&root, &format!("d{}/f{i}.txt", i % 100), "x\n");
    }
    r.stage_all().await.unwrap();
    r.commit("many files").await.unwrap();
    for i in 0..50_000 {
        write(&root, &format!("d{}/f{i}.txt", i % 100), "y\n");
    }
    let t = std::time::Instant::now();
    let st = r.status().await.unwrap();
    let took = t.elapsed();
    assert_eq!(st.files.len(), 50_000);
    println!("status of 50 000 changed files: {took:?}");
    assert!(took < std::time::Duration::from_secs(1), "took {took:?}");
}

#[tokio::test]
async fn background_fetch_is_non_interactive_and_sees_new_commits() {
    let g = git();
    let quiet = g.clone().non_interactive();
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
    ra.remote_add("origin", &url).await.unwrap();
    write(&a, "x.txt", "1\n");
    ra.stage_all().await.unwrap();
    ra.commit("one").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    let parent = tempfile::tempdir().unwrap();
    let b = repo::clone(&g, &url, &parent.path().join("copy"), None, |_| {})
        .await
        .unwrap();

    // The settings that keep credential windows closed reach git.
    let cfg = |key: &'static str| {
        let quiet = quiet.clone();
        let b = b.clone();
        async move {
            quiet
                .run(
                    &b,
                    ["config", "--get", key],
                    gitpilot_lib::git::runner::RunOpts {
                        ok_codes: &[1],
                        ..Default::default()
                    },
                )
                .await
                .unwrap()
                .text()
        }
    };
    assert_eq!(cfg("credential.interactive").await.trim(), "false");
    assert_eq!(cfg("core.askpass").await.trim(), "");

    write(&a, "x.txt", "1\n2\n");
    ra.stage_all().await.unwrap();
    ra.commit("two").await.unwrap();
    ra.push(None, false, false, None, |_| {}).await.unwrap();
    let rb = Repo {
        git: &quiet,
        path: &b,
    };
    rb.fetch(None, None, |_| {}).await.unwrap();
    assert_eq!(rb.status().await.unwrap().branch.behind, Some(1));
}

#[tokio::test]
async fn merge_tool_resolves_and_stages_a_conflict() {
    let g = git();
    let (_d, root) = new_repo(&g).await;
    let r = Repo {
        git: &g,
        path: &root,
    };
    write(&root, "a.txt", "base\n");
    r.stage_all().await.unwrap();
    r.commit("base").await.unwrap();
    r.branch_create("x", None, true).await.unwrap();
    write(&root, "a.txt", "theirs\n");
    r.stage_all().await.unwrap();
    r.commit("theirs").await.unwrap();
    r.branch_switch("main").await.unwrap();
    write(&root, "a.txt", "ours\n");
    r.stage_all().await.unwrap();
    r.commit("ours").await.unwrap();
    assert!(r.merge("x").await.is_err(), "conflict expected");

    // A stub tool that takes the incoming side, defined only in this repository.
    for (k, val) in [
        ("mergetool.stub.cmd", r#"cp "$REMOTE" "$MERGED""#),
        ("mergetool.stub.trustExitCode", "true"),
    ] {
        g.run(&root, ["config", k, val], Default::default())
            .await
            .unwrap();
    }
    assert!(r.conflict_mergetool("a.txt", "bad name").await.is_err());
    r.conflict_mergetool("a.txt", "stub").await.unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "theirs\n"
    );
    let st = r.status().await.unwrap();
    assert!(
        st.files.iter().all(|f| f.area != Area::Conflicted),
        "staged as resolved"
    );
    assert!(
        !root.join("a.txt.orig").exists(),
        "no backup file left behind"
    );
}
