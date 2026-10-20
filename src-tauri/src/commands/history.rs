use tauri::State;

use super::changes::repo;
use super::ctx;
use crate::error::AppResult;
use crate::git::diff::FileDiff;
use crate::git::log::{CommitDetail, LogPage, LogQuery};
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
