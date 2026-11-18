//! Turning a phone's command into work on a repository.
//!
//! This is the whole surface a paired phone has. There is no "run this git command": a phone can
//! ask for exactly the things below, each one landing on a function the app's own buttons already
//! use, under the same per-repository lock. Repositories are named by the id they have in
//! GitPilot's registry, never by a path, so a phone cannot point git at some other folder.
//!
//! What a phone is deliberately not allowed to do: force push, discard anything, change settings,
//! read a file outside a diff, or reach a repository that isn't registered here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::repo::{PullOptions, Repo, RepoState};
use crate::git::status::{Area, ChangeType};
use crate::state::AppState;

/// The largest diff worth sending to a phone. The relay refuses anything bigger anyway.
const MAX_DIFF_BYTES: usize = 48 * 1024;
/// How much history the phone shows per repository.
const COMMITS_SHOWN: u32 = 20;

/// Everything a phone may ask for.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "cmd", rename_all = "camelCase")]
#[ts(export)]
pub enum Command {
    /// Every registered repository, briefly: enough for the phone's list.
    List,
    /// One repository: its branch, changed files and recent commits.
    Open {
        repo: i64,
    },
    /// One file's diff.
    Diff {
        repo: i64,
        path: String,
        area: Area,
    },
    Stage {
        repo: i64,
        paths: Vec<String>,
    },
    Unstage {
        repo: i64,
        paths: Vec<String>,
    },
    Commit {
        repo: i64,
        message: String,
    },
    Fetch {
        repo: i64,
    },
    Pull {
        repo: i64,
    },
    /// Never a force push. `confirmed` is the extra tap on the phone.
    Push {
        repo: i64,
        confirmed: bool,
    },
    /// "Forget this computer", from the phone's side.
    ///
    /// Handled before dispatch, in `service`, because only that knows which device sent it -- and
    /// a phone may only ever unpair itself. There is nothing in the command to name another one.
    Unpair,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteRepo {
    pub id: i64,
    pub name: String,
    pub branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub changed: u32,
    pub conflicts: u32,
    /// Mid-merge, mid-rebase and so on, so the phone can say "finish this on the computer".
    pub state: RepoState,
}

/// The answer to `list`: which computer this is, and what is on it.
///
/// The name matters because a phone can be paired with several computers at once, and "Repositories"
/// on its own tells you nothing about which one you are looking at.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteOverview {
    pub computer: String,
    pub repos: Vec<RemoteRepo>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteFile {
    pub path: String,
    pub area: Area,
    pub change: ChangeType,
    pub conflict: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    #[ts(type = "number")]
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteDetail {
    #[serde(flatten)]
    pub repo: RemoteRepo,
    pub files: Vec<RemoteFile>,
    pub commits: Vec<RemoteCommit>,
}

/// What goes back to the phone. Errors keep the app's own plain wording, so the phone shows the
/// same sentence the desktop would -- already redacted, because `AppError` redacts its detail.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Reply {
    pub ok: bool,
    /// Plain-language outcome, shown as-is on the phone.
    pub message: String,
    pub kind: Option<ErrorKind>,
    pub detail: Option<String>,
    /// The command's payload, if it has one.
    #[ts(type = "unknown")]
    pub data: Option<serde_json::Value>,
}

impl Reply {
    pub(crate) fn ok(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: message.into(),
            kind: None,
            detail: None,
            data: None,
        }
    }

    fn with(mut self, data: impl Serialize) -> Self {
        self.data = serde_json::to_value(data).ok();
        self
    }

    /// A command this build doesn't know: a phone running a newer version of the app.
    pub fn unknown_command(detail: &str) -> Self {
        Self {
            ok: false,
            message: "This version of GitPilot doesn't understand that command. Update it on the computer."
                .to_string(),
            kind: Some(ErrorKind::InvalidInput),
            detail: Some(detail.to_string()),
            data: None,
        }
    }

    fn failed(e: AppError) -> Self {
        Self {
            ok: false,
            message: e.message,
            kind: Some(e.kind),
            detail: e.detail,
            data: None,
        }
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {many}")
    }
}

/// Runs one command and always answers: a failure is a `Reply`, not a lost message, because the
/// phone is waiting and an error it can read is worth more than silence.
pub async fn dispatch(state: &AppState, cmd: Command) -> Reply {
    match run(state, cmd).await {
        Ok(reply) => reply,
        Err(e) => Reply::failed(e),
    }
}

async fn run(state: &AppState, cmd: Command) -> AppResult<Reply> {
    match cmd {
        Command::List => list(state).await,
        Command::Open { repo } => open(state, repo).await,
        Command::Diff { repo, path, area } => diff(state, repo, &path, area).await,
        Command::Stage { repo, paths } => stage(state, repo, paths, false).await,
        Command::Unstage { repo, paths } => stage(state, repo, paths, true).await,
        Command::Commit { repo, message } => commit(state, repo, &message).await,
        Command::Fetch { repo } => fetch(state, repo).await,
        Command::Pull { repo } => pull(state, repo).await,
        Command::Push { repo, confirmed } => push(state, repo, confirmed).await,
        // `service::handle_envelope` deals with this one; it never reaches here.
        Command::Unpair => Ok(Reply::ok("Unpaired")),
    }
}

/// The same path every command takes to reach a repository: through the registry, by id.
macro_rules! with_repo {
    ($state:expr, $id:expr, $git:ident, $root:ident, $r:ident) => {
        let $git = $state.git()?;
        let $root = $state.repo_path($id)?;
        let $r = Repo {
            git: &$git,
            path: &$root,
        };
    };
}

fn summarise(id: i64, name: String, st: &crate::git::repo::RepoStatus) -> RemoteRepo {
    RemoteRepo {
        id,
        name,
        branch: st.branch.head.clone(),
        ahead: st.branch.ahead,
        behind: st.branch.behind,
        changed: st.files.len() as u32,
        conflicts: st.files.iter().filter(|f| f.conflict.is_some()).count() as u32,
        state: st.state,
    }
}

/// What this computer is called, for the phone's list of computers.
///
/// Whatever the operating system already calls it: nothing is invented, nothing is asked of the
/// user, and if it can't be found the phone just says "This computer".
pub fn computer_name() -> String {
    for var in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(name) = std::env::var(var) {
            let name = name.trim();
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "This computer".to_string())
}

async fn list(state: &AppState) -> AppResult<Reply> {
    let records = state.db(crate::db::list)?;
    // Resolve git once -- finding it searches PATH -- and ask every repository at the same time.
    // Status is mostly waiting for a child process, so the whole list costs about as long as the
    // slowest repository rather than all of them added up.
    let git = state.git()?;
    let mut jobs = tokio::task::JoinSet::new();
    for (order, rec) in records.into_iter().enumerate() {
        let Ok(path) = state.repo_path(rec.id) else {
            continue; // Moved or deleted: leave it out rather than failing the whole list.
        };
        let git = git.clone();
        jobs.spawn(async move {
            let repo = Repo {
                git: &git,
                path: &path,
            };
            repo.status()
                .await
                .ok()
                .map(|st| (order, summarise(rec.id, rec.name, &st)))
        });
    }

    let mut found: Vec<(usize, RemoteRepo)> = Vec::new();
    while let Some(done) = jobs.join_next().await {
        if let Ok(Some(entry)) = done {
            found.push(entry);
        }
    }
    // They finish in whatever order they like; the phone should see the registry's order.
    found.sort_by_key(|(order, _)| *order);
    let out: Vec<RemoteRepo> = found.into_iter().map(|(_, repo)| repo).collect();
    let n = out.len();
    Ok(
        Reply::ok(plural(n, "repository", "repositories")).with(RemoteOverview {
            computer: computer_name(),
            repos: out,
        }),
    )
}

async fn open(state: &AppState, id: i64) -> AppResult<Reply> {
    let name = state.db(|c| crate::db::get(c, id))?.name;
    with_repo!(state, id, git, root, r);
    // One status, used for both the summary and the file list.
    let st = r.status().await?;
    let repo = summarise(id, name, &st);
    let files = st
        .files
        .iter()
        .map(|f| RemoteFile {
            path: f.path.clone(),
            area: f.area,
            change: f.change,
            conflict: f.conflict.clone(),
        })
        .collect();
    let page = r
        .log(&crate::git::log::LogQuery {
            rev: None,
            skip: 0,
            limit: COMMITS_SHOWN,
            search: None,
            path: None,
            content: None,
            regex: false,
            since: None,
            until: None,
        })
        .await?;
    let commits = page
        .commits
        .into_iter()
        .map(|c| RemoteCommit {
            hash: c.hash,
            short_hash: c.short_hash,
            subject: c.subject,
            author: c.author_name,
            time: c.author_time,
        })
        .collect();
    Ok(Reply::ok(repo.name.clone()).with(RemoteDetail {
        repo,
        files,
        commits,
    }))
}

async fn diff(state: &AppState, id: i64, path: &str, area: Area) -> AppResult<Reply> {
    // The same rule the AI features use: a key or an .env file never leaves this computer.
    if crate::ai::is_sensitive(path) {
        return Err(AppError::invalid(
            "That file looks sensitive (keys, .env files…), so it isn't sent to the phone.",
        ));
    }
    with_repo!(state, id, git, root, r);
    let d = r.file_diff(path, area, None).await?;
    let json = serde_json::to_value(&d).unwrap_or(serde_json::Value::Null);
    if serde_json::to_string(&json).map(|s| s.len()).unwrap_or(0) > MAX_DIFF_BYTES {
        return Err(AppError::invalid(
            "That file's changes are too large to show on the phone. Open it on the computer.",
        ));
    }
    Ok(Reply::ok(path.to_string()).with(json))
}

async fn stage(state: &AppState, id: i64, paths: Vec<String>, undo: bool) -> AppResult<Reply> {
    if paths.is_empty() {
        return Err(AppError::invalid("No files were given to stage."));
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    with_repo!(state, id, git, root, r);
    // Paths are validated here exactly as they are for a click: relative, no "..", after `--`.
    if undo {
        r.unstage(&paths).await?;
    } else {
        r.stage(&paths).await?;
    }
    let what = plural(paths.len(), "file", "files");
    Ok(Reply::ok(if undo {
        format!("Unstaged {what}")
    } else {
        format!("Staged {what}")
    }))
}

async fn commit(state: &AppState, id: i64, message: &str) -> AppResult<Reply> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    with_repo!(state, id, git, root, r);
    // Never stages on its own: the phone stages explicitly, like the app does.
    let hash = r.commit(message).await?;
    let short = hash.chars().take(7).collect::<String>();
    Ok(Reply::ok(format!("Committed {short}")).with(serde_json::json!({ "hash": hash })))
}

async fn fetch(state: &AppState, id: i64) -> AppResult<Reply> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    with_repo!(state, id, git, root, r);
    r.fetch(None, None, |_| {}).await?;
    let st = r.status().await?;
    Ok(Reply::ok(match st.branch.behind {
        Some(n) if n > 0 => format!(
            "Fetched — {} to pull",
            plural(n as usize, "commit", "commits")
        ),
        _ => "Fetched — nothing new".to_string(),
    }))
}

async fn pull(state: &AppState, id: i64) -> AppResult<Reply> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    let strategy = state.settings().pull_strategy;
    with_repo!(state, id, git, root, r);
    // Whatever the user chose on the computer: fast-forward only unless they changed it. The
    // phone cannot pick a different strategy, and never allows unrelated histories.
    r.pull(
        strategy,
        PullOptions {
            strategy: None,
            allow_unrelated: false,
        },
        |_| {},
    )
    .await?;
    Ok(Reply::ok("Pulled"))
}

async fn push(state: &AppState, id: i64, confirmed: bool) -> AppResult<Reply> {
    if !confirmed {
        return Err(AppError::invalid(
            "Pushing from the phone needs to be confirmed on the phone first.",
        ));
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    with_repo!(state, id, git, root, r);
    // force_with_lease is false and nothing can set it: a phone can never rewrite a remote branch.
    r.push(None, false, false, None, |_| {}).await?;
    Ok(Reply::ok("Pushed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wire_format_names_each_command() {
        let cmd: Command =
            serde_json::from_str(r#"{"cmd":"push","repo":3,"confirmed":true}"#).unwrap();
        assert!(matches!(
            cmd,
            Command::Push {
                repo: 3,
                confirmed: true
            }
        ));

        let cmd: Command = serde_json::from_str(r#"{"cmd":"list"}"#).unwrap();
        assert!(matches!(cmd, Command::List));
    }

    #[test]
    fn unpairing_names_no_device() {
        // A phone can only unpair itself: the device comes from the sealed envelope, so there is
        // nothing in the command for one phone to point at another.
        let cmd: Command = serde_json::from_str(r#"{"cmd":"unpair"}"#).unwrap();
        assert!(matches!(cmd, Command::Unpair));
        assert_eq!(
            serde_json::to_string(&Command::Unpair).unwrap(),
            r#"{"cmd":"unpair"}"#
        );
    }

    #[test]
    fn anything_outside_the_list_is_not_a_command() {
        // The point of the enum: there is no "run", no path, no arbitrary git.
        assert!(serde_json::from_str::<Command>(r#"{"cmd":"run","args":["rm","-rf"]}"#).is_err());
        assert!(serde_json::from_str::<Command>(r#"{"cmd":"forcePush","repo":1}"#).is_err());
        assert!(serde_json::from_str::<Command>(r#"{"cmd":"diff","path":"a.txt"}"#).is_err());
    }

    #[test]
    fn a_failure_keeps_the_apps_own_wording() {
        let reply = Reply::failed(AppError::new(
            ErrorKind::MissingIdentity,
            "Set your name and email before committing.",
        ));

        assert!(!reply.ok);
        assert_eq!(reply.kind, Some(ErrorKind::MissingIdentity));
        assert!(reply.message.contains("name and email"));
    }

    #[test]
    fn the_computer_has_a_name_whatever_happens() {
        // Falls back rather than returning something empty for the phone to show.
        let name = computer_name();
        assert!(!name.trim().is_empty());
    }

    #[test]
    fn counts_read_naturally() {
        assert_eq!(plural(1, "file", "files"), "1 file");
        assert_eq!(plural(3, "file", "files"), "3 files");
    }
}
