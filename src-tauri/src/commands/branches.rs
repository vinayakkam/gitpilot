use tauri::State;

use super::changes::{repo, require_confirmation};
use super::ctx;
use crate::error::AppResult;
use crate::git::refs::{Branch, Stash};
use crate::git::repo::BranchComparison;
use crate::git::Repo;
use crate::state::AppState;

#[tauri::command]
pub async fn branch_list(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Branch>> {
    repo!(state, id, git, root, r);
    r.branches().await
}

#[tauri::command]
pub async fn branch_create(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    start: Option<String>,
    checkout: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.branch_create(&name, start.as_deref(), checkout).await
}

#[tauri::command]
pub async fn branch_switch(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.branch_switch(&name).await
}

#[tauri::command]
pub async fn branch_checkout_remote(
    state: State<'_, AppState>,
    id: i64,
    remote_branch: String,
    local_name: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.branch_checkout_remote(&remote_branch, &local_name).await
}

#[tauri::command]
pub async fn branch_rename(
    state: State<'_, AppState>,
    id: i64,
    old: String,
    new: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.branch_rename(&old, &new).await
}

#[tauri::command]
pub async fn branch_delete(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    force: bool,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.branch_delete(&name, force).await
}

#[tauri::command]
pub async fn branch_delete_remote(
    state: State<'_, AppState>,
    id: i64,
    remote: String,
    branch: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.remote_branch_delete(&remote, &branch).await
}

#[tauri::command]
pub async fn branch_compare(
    state: State<'_, AppState>,
    id: i64,
    base: String,
    head: String,
) -> AppResult<BranchComparison> {
    repo!(state, id, git, root, r);
    r.branch_compare(&base, &head).await
}

#[tauri::command]
pub async fn branch_set_upstream(
    state: State<'_, AppState>,
    id: i64,
    branch: String,
    upstream: Option<String>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.set_upstream(&branch, upstream.as_deref()).await
}

#[tauri::command]
pub async fn stash_list(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Stash>> {
    repo!(state, id, git, root, r);
    r.stash_list().await
}

#[tauri::command]
pub async fn stash_push(
    state: State<'_, AppState>,
    id: i64,
    message: String,
    include_untracked: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stash_push(&message, include_untracked).await
}

#[tauri::command]
pub async fn stash_apply(
    state: State<'_, AppState>,
    id: i64,
    index: u32,
    pop: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stash_apply(index, pop).await
}

#[tauri::command]
pub async fn stash_drop(
    state: State<'_, AppState>,
    id: i64,
    index: u32,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stash_drop(index).await
}

#[tauri::command]
pub async fn tag_list(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Vec<crate::git::everyday::Tag>> {
    repo!(state, id, git, root, r);
    r.tags().await
}

#[tauri::command]
pub async fn tag_create(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    target: String,
    message: String,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.tag_create(&name, &target, &message).await
}

#[tauri::command]
pub async fn tag_delete(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    confirmed: bool,
) -> AppResult<()> {
    crate::commands::changes::require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.tag_delete(&name).await
}

/// Pushes a tag to a remote, or with `delete` removes it there (needs `confirmed`).
#[tauri::command]
pub async fn tag_push(
    state: State<'_, AppState>,
    id: i64,
    remote: String,
    name: String,
    delete: bool,
    confirmed: bool,
) -> AppResult<()> {
    if delete {
        crate::commands::changes::require_confirmation(confirmed)?;
    }
    repo!(state, id, git, root, r);
    r.tag_push(&remote, &name, delete).await
}

#[tauri::command]
pub async fn worktree_list(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Vec<crate::git::worktrees::Worktree>> {
    repo!(state, id, git, root, r);
    r.worktrees().await
}

/// Checks out `branch` (a new one with `new_branch`, from `start`) in a new folder `path`.
#[tauri::command]
pub async fn worktree_add(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    branch: String,
    new_branch: bool,
    start: Option<String>,
) -> AppResult<String> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.worktree_add(&path, &branch, new_branch, start.as_deref())
        .await
}

#[tauri::command]
pub async fn worktree_remove(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.worktree_remove(&path).await
}

#[tauri::command]
pub async fn worktree_prune(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.worktree_prune().await
}
