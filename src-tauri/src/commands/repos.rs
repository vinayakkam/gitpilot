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
    window: tauri::Window,
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
    // One clone per window: cancel with op_cancel("clone:<window label>").
    let guard = state.begin_cancellable(format!("clone:{}", window.label()));
    let root = repo::clone(
        &git,
        &url,
        &dest,
        Some(&guard.notify),
        progress(&app, None, "clone"),
    )
    .await?;
    drop(guard);
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

/// Marks a repository as opened. `remember` (the main window only) makes it the one reopened
/// at startup.
#[tauri::command]
pub fn repo_open(state: State<'_, AppState>, id: i64, remember: bool) -> AppResult<RepoRecord> {
    state.db(|c| db::touch(c, id))?;
    if remember {
        state.update_settings(|s| s.last_repo_id = Some(id))?;
    }
    state.db(|c| db::get(c, id))
}

/// Starts watching a repository's files; the UI receives "repo-changed" events with its id.
#[tauri::command]
pub async fn repo_watch(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<()> {
    use tauri::Emitter;
    let root = state.repo_path(id)?;
    state
        .watches
        .watch(id, root, move || {
            let _ = app.emit("repo-changed", id);
        })
        .map_err(|e| {
            AppError::new(
                ErrorKind::Internal,
                "Couldn't watch the repository for changes.",
            )
            .with_detail(e)
        })?;
    state.note_watch(window.label(), id);
    Ok(())
}

#[tauri::command]
pub async fn repo_unwatch(
    window: tauri::Window,
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<()> {
    // Only release watches this window took, so a repeated unwatch can't stop another window's.
    if state.note_unwatch(window.label(), id) {
        state.watches.unwatch(id);
    }
    Ok(())
}

/// Opens repository `id` in its own window, or brings that window to the front if it's open.
/// The window's label (`repo-<id>`) tells the page which repository to show.
#[tauri::command]
pub async fn window_open_repo(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<()> {
    use tauri::Manager;
    let rec = state.db(|c| db::get(c, id))?;
    let label = format!("repo-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title(format!("{} — GitPilot", rec.name))
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 580.0)
        .build()
        .map_err(|e| {
            AppError::new(ErrorKind::Internal, "The new window couldn't be opened.")
                .with_detail(e.to_string())
        })?;
    Ok(())
}
