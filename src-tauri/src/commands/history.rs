use tauri::State;

use super::changes::{repo, require_confirmation};
use super::ctx;
use crate::error::AppResult;
use crate::git::diff::FileDiff;
use crate::git::log::{CommitDetail, LogPage, LogQuery};
use crate::git::repo::SequenceAction;
use crate::git::Repo;
use crate::state::AppState;

#[tauri::command]
pub async fn log_get(state: State<'_, AppState>, id: i64, query: LogQuery) -> AppResult<LogPage> {
    repo!(state, id, git, root, r);
    r.log(&query).await
}

#[tauri::command]
pub async fn commit_get(
    state: State<'_, AppState>,
    id: i64,
    hash: String,
) -> AppResult<CommitDetail> {
    repo!(state, id, git, root, r);
    r.commit_detail(&hash).await
}

#[tauri::command]
pub async fn commit_diff_file(
    state: State<'_, AppState>,
    id: i64,
    hash: String,
    path: String,
    orig_path: Option<String>,
) -> AppResult<FileDiff> {
    repo!(state, id, git, root, r);
    r.commit_file_diff(&hash, &path, orig_path.as_deref()).await
}

#[tauri::command]
pub async fn commit_revert(state: State<'_, AppState>, id: i64, hash: String) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.revert(&hash).await
}

#[tauri::command]
pub async fn commit_cherry_pick(
    state: State<'_, AppState>,
    id: i64,
    hash: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.cherry_pick(&hash).await
}

#[tauri::command]
pub async fn branch_merge(state: State<'_, AppState>, id: i64, branch: String) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.merge(&branch).await
}

/// Rewrites the current branch's history; the UI must confirm first.
#[tauri::command]
pub async fn branch_rebase(
    state: State<'_, AppState>,
    id: i64,
    onto: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.rebase(&onto).await
}

/// Continue / skip / abort the operation in progress. Abort and skip discard work, so they need confirmation.
#[tauri::command]
pub async fn sequence_run(
    state: State<'_, AppState>,
    id: i64,
    action: SequenceAction,
    confirmed: bool,
) -> AppResult<()> {
    if action != SequenceAction::Continue {
        require_confirmation(confirmed)?;
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.sequence(action).await
}
