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

#[tauri::command]
pub async fn file_blame(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    rev: Option<String>,
) -> AppResult<crate::git::explore::BlameResult> {
    repo!(state, id, git, root, r);
    r.blame(&path, rev.as_deref()).await
}

#[tauri::command]
pub async fn compare_files(
    state: State<'_, AppState>,
    id: i64,
    base: String,
    head: String,
    three_dot: bool,
) -> AppResult<Vec<crate::git::log::CommitFile>> {
    repo!(state, id, git, root, r);
    r.compare_files(&base, &head, three_dot).await
}

#[tauri::command]
pub async fn compare_file_diff(
    state: State<'_, AppState>,
    id: i64,
    base: String,
    head: String,
    three_dot: bool,
    path: String,
    orig_path: Option<String>,
) -> AppResult<crate::git::diff::FileDiff> {
    repo!(state, id, git, root, r);
    r.compare_file_diff(&base, &head, three_dot, &path, orig_path.as_deref())
        .await
}

#[tauri::command]
pub async fn conflict_resolve_block(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    index: u32,
    choice: crate::git::rewrite::ConflictChoice,
) -> AppResult<u32> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    Ok(r.conflict_resolve_block(&path, index as usize, choice)
        .await? as u32)
}

/// Applies an AI suggestion the user accepted to one conflict block. Returns the blocks still left.
#[tauri::command]
pub async fn conflict_apply_text(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    index: u32,
    expected: String,
    text: String,
) -> AppResult<u32> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    Ok(
        r.conflict_apply_text(&path, index as usize, &expected, &text)
            .await? as u32,
    )
}

#[tauri::command]
pub async fn conflict_take_side(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    current: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.conflict_take_side(&path, current).await
}

/// Commits after `base` (null = all), oldest first, for the Edit commits dialog.
#[tauri::command]
pub async fn rebase_commits(
    state: State<'_, AppState>,
    id: i64,
    base: Option<String>,
) -> AppResult<Vec<crate::git::rewrite::RebaseCommit>> {
    repo!(state, id, git, root, r);
    r.rebase_commits(base.as_deref()).await
}

#[tauri::command]
pub async fn rebase_interactive(
    state: State<'_, AppState>,
    id: i64,
    base: Option<String>,
    steps: Vec<crate::git::rewrite::RebaseStep>,
    confirmed_pushed: bool,
) -> AppResult<crate::git::rewrite::Backup> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.rebase_interactive(base.as_deref(), &steps, confirmed_pushed)
        .await
}

/// Moves the current branch to `target`; a backup is made first. Hard resets need `confirmed`.
#[tauri::command]
pub async fn branch_reset(
    state: State<'_, AppState>,
    id: i64,
    target: String,
    mode: crate::git::rewrite::ResetMode,
    confirmed: bool,
) -> AppResult<crate::git::rewrite::Backup> {
    if mode == crate::git::rewrite::ResetMode::Hard {
        require_confirmation(confirmed)?;
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.reset_to(&target, mode).await
}

#[tauri::command]
pub async fn backup_list(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Vec<crate::git::rewrite::Backup>> {
    repo!(state, id, git, root, r);
    r.backups().await
}

#[tauri::command]
pub async fn backup_restore(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.backup_restore(&name).await
}

#[tauri::command]
pub async fn backup_delete(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    repo!(state, id, git, root, r);
    r.backup_delete(&name).await
}
