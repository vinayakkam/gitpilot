use tauri::State;

use super::ctx;
use crate::error::AppResult;
use crate::git::diff::FileDiff;
use crate::git::repo::{DiscardResult, Identity, RepoStatus};
use crate::git::status::Area;
use crate::git::Repo;
use crate::state::AppState;

macro_rules! repo {
    ($state:expr, $id:expr, $git:ident, $path:ident, $r:ident) => {
        let ($git, $path) = ctx(&$state, $id)?;
        let $r = Repo {
            git: &$git,
            path: &$path,
        };
    };
}
pub(crate) use repo;

#[tauri::command]
pub async fn status_get(state: State<'_, AppState>, id: i64) -> AppResult<RepoStatus> {
    repo!(state, id, git, path, r);
    r.status().await
}

#[tauri::command]
pub async fn diff_file(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    area: Area,
    orig_path: Option<String>,
) -> AppResult<FileDiff> {
    repo!(state, id, git, root, r);
    r.file_diff(&path, area, orig_path.as_deref()).await
}

#[tauri::command]
pub async fn stage_paths(state: State<'_, AppState>, id: i64, paths: Vec<String>) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stage(&paths).await
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.unstage(&paths).await
}

#[tauri::command]
pub async fn stage_all(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stage_all().await
}

#[tauri::command]
pub async fn unstage_all(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.unstage_all().await
}

#[tauri::command]
pub async fn hunk_apply(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    header: String,
    unstage: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.apply_hunk(&path, &header, unstage).await
}

/// Destructive: the UI must confirm first. `confirmed` must be true.
#[tauri::command]
pub async fn discard_tracked(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
    confirmed: bool,
) -> AppResult<DiscardResult> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.discard_tracked(&paths, &state.backup_dir()).await
}

/// Destructive: moves untracked files to the trash. `confirmed` must be true.
#[tauri::command]
pub async fn discard_untracked(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
    confirmed: bool,
) -> AppResult<DiscardResult> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.discard_untracked(&paths).await
}

pub(crate) fn require_confirmation(confirmed: bool) -> AppResult<()> {
    if confirmed {
        Ok(())
    } else {
        Err(crate::error::AppError::invalid(
            "This action needs to be confirmed.",
        ))
    }
}

#[tauri::command]
pub async fn commit_create(
    state: State<'_, AppState>,
    id: i64,
    message: String,
) -> AppResult<String> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.commit(&message).await
}

#[tauri::command]
pub async fn identity_get(state: State<'_, AppState>, id: i64) -> AppResult<Identity> {
    repo!(state, id, git, root, r);
    r.identity().await
}

#[tauri::command]
pub async fn identity_set(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    email: String,
    global: bool,
) -> AppResult<()> {
    repo!(state, id, git, root, r);
    r.set_identity(&name, &email, global).await
}

#[tauri::command]
pub async fn files_search(
    state: State<'_, AppState>,
    id: i64,
    query: String,
) -> AppResult<Vec<String>> {
    repo!(state, id, git, root, r);
    r.search_files(&query, 40).await
}

#[tauri::command]
pub async fn lines_apply(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    header: String,
    lines: Vec<u32>,
    unstage: bool,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.apply_lines(&path, &header, &lines, unstage).await
}

/// Staged files that would be committed with Windows (CRLF) line endings.
#[tauri::command]
pub async fn eol_check(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<crate::git::eol::EolReport> {
    repo!(state, id, git, root, r);
    r.eol_check().await
}

/// Rewrites the given staged files (and their working copies, after a backup) with LF endings.
#[tauri::command]
pub async fn eol_fix(state: State<'_, AppState>, id: i64, paths: Vec<String>) -> AppResult<u32> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.eol_fix(&paths, &state.backup_dir()).await
}

/// Adds `* text=auto` to .gitattributes so Git normalizes line endings from now on.
#[tauri::command]
pub async fn eol_add_gitattributes(state: State<'_, AppState>, id: i64) -> AppResult<bool> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.eol_add_gitattributes().await
}

/// Adds patterns to .gitignore. Paths in `untrack` are also removed from Git's index
/// (kept on disk), which needs `confirmed` because committing it removes them for everyone.
#[tauri::command]
pub async fn gitignore_add(
    state: State<'_, AppState>,
    id: i64,
    patterns: Vec<String>,
    untrack: Vec<String>,
    confirmed: bool,
) -> AppResult<Vec<String>> {
    if !untrack.is_empty() {
        require_confirmation(confirmed)?;
    }
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    let added = r.ignore_add(&patterns).await?;
    r.untrack(&untrack).await?;
    Ok(added)
}

/// Stops tracking files without deleting them (`git rm --cached`). Needs `confirmed`.
#[tauri::command]
pub async fn untrack_paths(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.untrack(&paths).await
}

/// The last commit (for amend/undo), or null in a repository without commits.
#[tauri::command]
pub async fn last_commit(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Option<crate::git::everyday::LastCommit>> {
    repo!(state, id, git, root, r);
    r.last_commit().await
}

/// Commits staged changes, or replaces the last commit with `amend`. Amending a commit that
/// was already pushed needs `confirmed_pushed`.
#[tauri::command]
pub async fn commit_amend(
    state: State<'_, AppState>,
    id: i64,
    message: String,
    confirmed_pushed: bool,
) -> AppResult<String> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    if let Some(last) = r.last_commit().await? {
        if last.pushed && !confirmed_pushed {
            return Err(crate::error::AppError::invalid(
                "The last commit has already been pushed. Confirm to amend it anyway.",
            ));
        }
    }
    r.commit_with(&message, true).await
}

/// Takes back the last commit; its changes stay staged. Returns its message.
#[tauri::command]
pub async fn commit_undo(
    state: State<'_, AppState>,
    id: i64,
    confirmed_pushed: bool,
) -> AppResult<String> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.undo_last_commit(confirmed_pushed).await
}

/// Discards one hunk, or some lines of it, from a file's unstaged changes (backed up first).
#[tauri::command]
pub async fn discard_partial(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    header: String,
    lines: Option<Vec<u32>>,
    confirmed: bool,
) -> AppResult<Option<String>> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.discard_partial(&path, &header, lines.as_deref(), &state.backup_dir())
        .await
}

/// Stashes only the given files (all changes when `paths` is empty).
#[tauri::command]
pub async fn stash_paths(
    state: State<'_, AppState>,
    id: i64,
    message: String,
    include_untracked: bool,
    paths: Vec<String>,
) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.stash_push_paths(&message, include_untracked, &paths)
        .await
}

#[tauri::command]
pub async fn lfs_status(
    state: State<'_, AppState>,
    id: i64,
    with_files: bool,
) -> AppResult<crate::git::lfs::LfsStatus> {
    repo!(state, id, git, root, r);
    r.lfs_status(with_files).await
}

#[tauri::command]
pub async fn lfs_track(state: State<'_, AppState>, id: i64, pattern: String) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.lfs_track(&pattern).await
}

#[tauri::command]
pub async fn lfs_untrack(
    state: State<'_, AppState>,
    id: i64,
    pattern: String,
    confirmed: bool,
) -> AppResult<()> {
    require_confirmation(confirmed)?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.lfs_untrack(&pattern).await
}

#[tauri::command]
pub async fn lfs_install_hooks(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.lfs_install_hooks().await
}
