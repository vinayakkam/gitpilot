use tauri::State;

use crate::editors::{self, EditorInfo};
use crate::error::AppResult;
use crate::git::validate as v;
use crate::state::AppState;

use super::changes::repo;
use super::ctx;
use crate::git::Repo;

/// Code editors found on this machine.
#[tauri::command]
pub fn editor_list(state: State<'_, AppState>) -> Vec<EditorInfo> {
    editors::detect(&state.settings().tools.editor_path)
}

/// Opens the repository, or one of its files at a line, in the chosen editor.
#[tauri::command]
pub fn editor_open(
    state: State<'_, AppState>,
    id: i64,
    path: Option<String>,
    line: Option<u32>,
) -> AppResult<()> {
    let s = state.settings();
    let root = state.repo_path(id)?;
    let file = match &path {
        Some(p) => Some((v::rel_path(p)?, line)),
        None => None,
    };
    editors::open(&s.tools.editor, &s.tools.editor_path, &root, file)
}

/// Opens a terminal window in the repository folder.
#[tauri::command]
pub fn terminal_open(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let root = state.repo_path(id)?;
    editors::open_terminal(&root, &state.settings().claude_code.terminal)
}

/// Resolves a conflicted file in the external merge tool from Settings (or Git's merge.tool).
#[tauri::command]
pub async fn conflict_mergetool(
    state: State<'_, AppState>,
    id: i64,
    path: String,
) -> AppResult<()> {
    let tool = state.settings().tools.merge_tool;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    r.conflict_mergetool(&path, &tool).await
}
