use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};
use ts_rs::TS;

use super::progress;
use crate::db::{self, RepoRecord};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::repo;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PathInspection {
    pub exists: bool,
    pub is_dir: bool,
    /// Root of the repository containing this folder, if any.
    pub repo_root: Option<String>,
    pub is_empty: bool,
    #[ts(type = "number | null")]
    pub registered_id: Option<i64>,
}

fn name_of(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.display().to_string())
}

fn abs(path: &str) -> AppResult<PathBuf> {
    let p = PathBuf::from(path.trim());
    if path.trim().is_empty() || !p.is_absolute() {
        return Err(AppError::invalid("Choose a folder."));
    }
    Ok(p)
}

#[tauri::command]
pub fn repo_list(state: State<'_, AppState>) -> AppResult<Vec<RepoRecord>> {
    state.db(db::list)
}

#[tauri::command]
pub async fn repo_inspect_path(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<PathInspection> {
    let p = abs(&path)?;
    let exists = p.exists();
    let is_dir = p.is_dir();
    let is_empty = is_dir
        && p.read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
    let repo_root = if is_dir {
        repo::discover(&state.git()?, &p)
            .await
            .ok()
            .map(|r| r.display().to_string())
    } else {
        None
    };
    let registered_id = match &repo_root {
        Some(r) => state.db(|c| db::find_by_path(c, r))?.map(|r| r.id),
        None => None,
    };
    Ok(PathInspection {
        exists,
        is_dir,
        repo_root,
        is_empty,
        registered_id,
    })
}

#[tauri::command]
pub async fn repo_add(state: State<'_, AppState>, path: String) -> AppResult<RepoRecord> {
    let p = abs(&path)?;
    let root = repo::discover(&state.git()?, &p).await?;
    let root_s = root.display().to_string();
    state.db(|c| db::add(c, &root_s, &name_of(&root)))
}

#[tauri::command]
pub async fn repo_init(state: State<'_, AppState>, path: String) -> AppResult<RepoRecord> {
    let p = abs(&path)?;
    let git = state.git()?;
    if repo::discover(&git, &p).await.is_ok() {
        return Err(AppError::new(
            ErrorKind::AlreadyExists,
            "This folder is already inside a Git repository.",
        ));
    }
    let branch = state.settings().default_branch;
    repo::init(&git, &p, Some(branch.as_str())).await?;
    let root = repo::discover(&git, &p).await?;
    let root_s = root.display().to_string();
    state.db(|c| db::add(c, &root_s, &name_of(&root)))
}

#[tauri::command]
pub async fn repo_clone(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    parent: String,
    name: String,
) -> AppResult<RepoRecord> {
    let parent = abs(&parent)?;
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(AppError::invalid(
            "Enter a folder name for the clone (no slashes).",
        ));
    }
    let dest = parent.join(name);
    let git = state.git()?;
    let root = repo::clone(&git, &url, &dest, progress(&app, None, "clone")).await?;
    let root_s = root.display().to_string();
    state.db(|c| db::add(c, &root_s, &name_of(&root)))
}

#[tauri::command]
pub fn repo_remove(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db(|c| db::remove(c, id))?;
    if state.settings().last_repo_id == Some(id) {
        state.update_settings(|s| s.last_repo_id = None)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn repo_relocate(
    state: State<'_, AppState>,
    id: i64,
    path: String,
) -> AppResult<RepoRecord> {
    let p = abs(&path)?;
    let root = repo::discover(&state.git()?, &p).await?;
    let root_s = root.display().to_string();
    let name = state.db(|c| db::get(c, id))?.name;
    state.db(|c| db::relocate(c, id, &root_s, &name))
}

#[tauri::command]
pub fn repo_rename(state: State<'_, AppState>, id: i64, name: String) -> AppResult<RepoRecord> {
    state.db(|c| db::rename(c, id, &name))
}

#[tauri::command]
pub fn repo_open(state: State<'_, AppState>, id: i64) -> AppResult<RepoRecord> {
    state.db(|c| db::touch(c, id))?;
    state.update_settings(|s| s.last_repo_id = Some(id))?;
    state.db(|c| db::get(c, id))
}
