//! What a paired phone can and cannot do, against real temporary repositories.
//!
//! The unit tests cover the envelope and the relay client; this covers the part that matters to
//! the user: a command from the phone does the same thing a click in the app does, and everything
//! outside the short list is refused.

use std::path::{Path, PathBuf};
use std::sync::Once;

use gitpilot_lib::error::ErrorKind;
use gitpilot_lib::git::locate::locate_git;
use gitpilot_lib::git::repo::{self, Repo};
use gitpilot_lib::git::status::Area;
use gitpilot_lib::git::Git;
use gitpilot_lib::remote::crypto::{self, PairingKey};
use gitpilot_lib::remote::dispatch::{dispatch, Command, Reply};
use gitpilot_lib::state::AppState;
use tempfile::TempDir;

static ENV: Once = Once::new();

fn setup_env() {
    ENV.call_once(|| {
        let dir = std::env::temp_dir().join(format!("gitpilot-remote-home-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("gitconfig");
        std::fs::write(
            &cfg,
            "[user]\n\tname = Test User\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n",
        )
        .unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &cfg);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    });
}

fn git() -> Git {
    setup_env();
    Git::new(locate_git(None).expect("git must be installed to run tests"))
}

fn write(root: &Path, rel: &str, content: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

/// An app with one registered repository that already has a commit.
async fn app() -> (TempDir, TempDir, AppState, i64, PathBuf) {
    let g = git();
    let work = tempfile::tempdir().unwrap();
    repo::init(&g, work.path(), Some("main")).await.unwrap();
    let root = repo::discover(&g, work.path()).await.unwrap();

    write(&root, "README.md", "first\n");
    let r = Repo {
        git: &g,
        path: &root,
    };
    r.stage(&["README.md".to_string()]).await.unwrap();
    r.commit("Add a readme").await.unwrap();

    let home = tempfile::tempdir().unwrap();
    let state = AppState::new(home.path().join("data"), home.path().join("config")).unwrap();
    let id = state
        .db(|c| gitpilot_lib::db::add(c, &root.to_string_lossy(), "test-repo"))
        .unwrap()
        .id;

    (work, home, state, id, root)
}

fn data(reply: &Reply) -> serde_json::Value {
    assert!(reply.ok, "expected success, got: {}", reply.message);
    reply.data.clone().expect("a payload")
}

#[tokio::test]
async fn the_phone_sees_the_repositories_and_their_branch() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "notes.txt", "scratch\n");

    let reply = dispatch(&state, Command::List).await;

    let overview = data(&reply);
    assert!(!overview["computer"].as_str().unwrap_or_default().is_empty());
    let first = &overview["repos"].as_array().unwrap()[0];
    assert_eq!(first["id"].as_i64(), Some(id));
    assert_eq!(first["name"].as_str(), Some("test-repo"));
    assert_eq!(first["branch"].as_str(), Some("main"));
    assert_eq!(first["changed"].as_u64(), Some(1));
}

#[tokio::test]
async fn opening_a_repository_shows_files_and_recent_commits() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "notes.txt", "scratch\n");

    let reply = dispatch(&state, Command::Open { repo: id }).await;

    let detail = data(&reply);
    assert_eq!(detail["files"][0]["path"].as_str(), Some("notes.txt"));
    assert_eq!(
        detail["commits"][0]["subject"].as_str(),
        Some("Add a readme")
    );
    assert_eq!(detail["branch"].as_str(), Some("main"));
}

#[tokio::test]
async fn staging_and_committing_from_the_phone_works_like_a_click() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "notes.txt", "from the phone\n");

    let staged = dispatch(
        &state,
        Command::Stage {
            repo: id,
            paths: vec!["notes.txt".into()],
        },
    )
    .await;
    assert!(staged.ok, "{}", staged.message);
    assert_eq!(staged.message, "Staged 1 file");

    let committed = dispatch(
        &state,
        Command::Commit {
            repo: id,
            message: "Add notes from the phone".to_string(),
        },
    )
    .await;

    assert!(committed.ok, "{}", committed.message);
    let g = git();
    let r = Repo {
        git: &g,
        path: &root,
    };
    assert!(r.status().await.unwrap().files.is_empty());
}

#[tokio::test]
async fn unstaging_from_the_phone_works() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "notes.txt", "x\n");
    dispatch(
        &state,
        Command::Stage {
            repo: id,
            paths: vec!["notes.txt".into()],
        },
    )
    .await;

    let reply = dispatch(
        &state,
        Command::Unstage {
            repo: id,
            paths: vec!["notes.txt".into()],
        },
    )
    .await;

    assert!(reply.ok, "{}", reply.message);
    let g = git();
    let r = Repo {
        git: &g,
        path: &root,
    };
    let st = r.status().await.unwrap();
    assert_eq!(st.files[0].area, Area::Untracked);
}

#[tokio::test]
async fn committing_nothing_explains_itself_instead_of_staging_for_you() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "notes.txt", "never staged\n");

    let reply = dispatch(
        &state,
        Command::Commit {
            repo: id,
            message: "Should not happen".to_string(),
        },
    )
    .await;

    assert!(!reply.ok);
    assert_eq!(reply.kind, Some(ErrorKind::NothingToCommit));
    // The file is still untracked: a phone commit never stages on its own.
    let g = git();
    let r = Repo {
        git: &g,
        path: &root,
    };
    assert_eq!(r.status().await.unwrap().files.len(), 1);
}

#[tokio::test]
async fn a_push_without_the_confirmation_tap_is_refused() {
    let (_w, _h, state, id, _root) = app().await;

    let reply = dispatch(
        &state,
        Command::Push {
            repo: id,
            confirmed: false,
        },
    )
    .await;

    assert!(!reply.ok);
    assert!(
        reply.message.contains("confirmed on the phone"),
        "{}",
        reply.message
    );
}

#[tokio::test]
async fn a_phone_cannot_reach_outside_the_repository() {
    let (_w, _h, state, id, _root) = app().await;

    for path in ["../outside.txt", "/etc/passwd", "..\\\\windows\\\\system32"] {
        let reply = dispatch(
            &state,
            Command::Stage {
                repo: id,
                paths: vec![path.to_string()],
            },
        )
        .await;

        assert!(!reply.ok, "{path} was accepted");
    }
}

#[tokio::test]
async fn a_phone_cannot_reach_a_repository_that_isnt_registered() {
    let (_w, _h, state, _id, _root) = app().await;

    let reply = dispatch(&state, Command::Open { repo: 9999 }).await;

    assert!(!reply.ok);
}

#[tokio::test]
async fn a_sensitive_file_is_never_sent_to_the_phone() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, ".env", "API_KEY=supersecret\n");

    let reply = dispatch(
        &state,
        Command::Diff {
            repo: id,
            path: ".env".to_string(),
            area: Area::Untracked,
        },
    )
    .await;

    assert!(!reply.ok);
    assert!(reply.message.contains("sensitive"), "{}", reply.message);
    let shown = format!("{reply:?}");
    assert!(!shown.contains("supersecret"), "the secret leaked: {shown}");
}

#[tokio::test]
async fn a_normal_diff_comes_through() {
    let (_w, _h, state, id, root) = app().await;
    write(&root, "README.md", "first\nsecond\n");

    let reply = dispatch(
        &state,
        Command::Diff {
            repo: id,
            path: "README.md".to_string(),
            area: Area::Unstaged,
        },
    )
    .await;

    let diff = data(&reply);
    let text = serde_json::to_string(&diff).unwrap();
    assert!(text.contains("second"), "{text}");
}

#[tokio::test]
async fn a_command_survives_the_round_trip_the_phone_actually_makes() {
    // Phone: seal a command. Computer: open it, run it, seal the answer. Phone: open the answer.
    let (_w, _h, state, id, _root) = app().await;
    let key = PairingKey::generate();
    let now = 1_763_300_000;

    let command = serde_json::to_vec(&Command::Open { repo: id }).unwrap();
    let sealed = crypto::seal(&key, "phone", 1, now, &command);
    let wire = serde_json::to_string(&sealed).unwrap();

    // Nothing readable crosses the relay.
    assert!(!wire.contains("open"));

    let received: crypto::Envelope = serde_json::from_str(&wire).unwrap();
    let plain = crypto::open(&key, &received, "phone", 0, now).unwrap();
    let cmd: Command = serde_json::from_slice(&plain).unwrap();
    let reply = dispatch(&state, cmd).await;

    let answer = crypto::seal(
        &key,
        "phone~pc",
        1,
        now,
        &serde_json::to_vec(&reply).unwrap(),
    );
    let back = crypto::open(&key, &answer, "phone~pc", 0, now).unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&back).unwrap();

    assert_eq!(parsed["ok"].as_bool(), Some(true));
    assert_eq!(parsed["data"]["branch"].as_str(), Some("main"));
}
