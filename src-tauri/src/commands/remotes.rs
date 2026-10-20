use tauri::{AppHandle, State};

use super::changes::{repo, require_confirmation};
use super::{ctx, progress};
use crate::error::AppResult;
use crate::git::refs::Remote;
use crate::git::Repo;
use crate::state::AppState;

#[tauri::command]
pub async fn remote_list(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Remote>> {
    repo!(state, id, git, root, r);
    r.remotes().await
}

#[tauri::command]
pub async fn remote_add(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    url: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.remote_add(&name, &url).await
}

#[tauri::command]
pub async fn remote_set_url(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    url: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.remote_set_url(&name, &url).await
}

#[tauri::command]
pub async fn remote_remove(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.remote_remove(&name).await
}

#[tauri::command]
pub async fn sync_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    remote: Option<String>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    let guard = state.begin_cancellable(format!("repo:{id}"));
    r.fetch(
        remote.as_deref(),
        Some(&guard.notify),
        progress(&app, Some(id), "fetch"),
    )
    .await
}

#[tauri::command]
pub async fn sync_pull(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    let strategy = state.settings().pull_strategy;
    repo!(state, id, git, root, r);
    r.pull(strategy, progress(&app, Some(id), "pull")).await
}

#[tauri::command]
pub async fn sync_push(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    remote: Option<String>,
    set_upstream: bool,
    force_with_lease: bool,
    confirmed_force: bool,
) -> AppResult<()> {
    if force_with_lease {
        require_confirmation(confirmed_force)?;
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    let guard = state.begin_cancellable(format!("repo:{id}"));
    r.push(
        remote.as_deref(),
        set_upstream,
        force_with_lease,
        Some(&guard.notify),
        progress(&app, Some(id), "push"),
    )
    .await
}

/// Cancels a running clone ("clone") or fetch/push ("repo:<id>").
#[tauri::command]
pub fn op_cancel(state: State<'_, AppState>, key: String) -> bool {
    state.cancel(&key)
}
