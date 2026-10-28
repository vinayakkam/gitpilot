use tauri::{AppHandle, State};

use super::changes::{repo, require_confirmation};
use super::{ctx, progress};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::refs::Remote;
use crate::git::repo::PullOptions;
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
    quiet: Option<bool>,
) -> AppResult<()> {
    let quiet = quiet.unwrap_or(false);
    let lock = state.repo_lock(id);
    let _g = if quiet {
        // Auto-fetch never waits behind (or delays) something the user started.
        lock.try_lock().map_err(|_| {
            AppError::new(
                ErrorKind::Locked,
                "Another operation is running in this repository.",
            )
        })?
    } else {
        lock.lock().await
    };
    let (git, root) = ctx(&state, id)?;
    let git = if quiet { git.non_interactive() } else { git };
    let r = Repo {
        git: &git,
        path: &root,
    };
    let guard = state.begin_cancellable(format!("repo:{id}"));
    if quiet {
        r.fetch(remote.as_deref(), Some(&guard.notify), |_| {})
            .await
    } else {
        r.fetch(
            remote.as_deref(),
            Some(&guard.notify),
            progress(&app, Some(id), "fetch"),
        )
        .await
    }
}

#[tauri::command]
pub async fn sync_pull(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    options: Option<PullOptions>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    let strategy = state.settings().pull_strategy;
    repo!(state, id, git, root, r);
    let opts = options.unwrap_or(PullOptions {
        strategy: None,
        allow_unrelated: false,
    });
    r.pull(strategy, opts, progress(&app, Some(id), "pull"))
        .await
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

#[tauri::command]
pub async fn submodule_list(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Vec<crate::git::submodules::Submodule>> {
    repo!(state, id, git, root, r);
    r.submodules().await
}

/// Downloads and checks out submodules (`paths` empty = all). Cancel with `op_cancel("repo:<id>")`.
#[tauri::command]
pub async fn submodule_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    let guard = state.begin_cancellable(format!("repo:{id}"));
    r.submodule_update(
        &paths,
        Some(&guard.notify),
        progress(&app, Some(id), "submodule"),
    )
    .await
}
