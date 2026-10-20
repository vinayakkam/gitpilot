use tauri::State;

use super::changes::repo;
use super::ctx;
use crate::ai::{self, AiSuggestions};
use crate::claude_code::{self, ClaudeCodeInfo};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::Repo;
use crate::secrets;
use crate::state::AppState;

#[tauri::command]
pub async fn ai_suggest_commit(state: State<'_, AppState>, id: i64) -> AppResult<AiSuggestions> {
    let s = state.settings();
    if !s.ai.privacy_acknowledged {
        return Err(AppError::new(
            ErrorKind::AiNotConfigured,
            "Review the privacy notice in Settings → AI before sending code to an AI provider.",
        ));
    }
    repo!(state, id, git, root, r);
    let raw = r.staged_diff_raw().await?;
    let raw = String::from_utf8_lossy(&raw).into_owned();
    let key = secrets::get(s.ai.provider);
    ai::suggest(&s.ai, s.commit_convention, key, &raw).await
}

#[tauri::command]
pub async fn claude_detect(state: State<'_, AppState>) -> AppResult<ClaudeCodeInfo> {
    let s = state.settings();
    Ok(claude_code::detect(&s.claude_code.path, &s.claude_code.terminal).await)
}

#[tauri::command]
pub async fn claude_launch(
    state: State<'_, AppState>,
    id: i64,
    prompt: Option<String>,
) -> AppResult<()> {
    let s = state.settings();
    let (path, _) = claude_code::locate(&s.claude_code.path).ok_or_else(|| {
        AppError::new(
            ErrorKind::ClaudeCodeNotFound,
            "Claude Code isn't installed or couldn't be found. Install it (see docs.claude.com) or set its path in Settings → Claude Code.",
        )
    })?;
    let root = state.repo_path(id)?;
    claude_code::launch(&path, &root, prompt.as_deref(), &s.claude_code.terminal)
}

/// Staged diff stats for prompt templates (counts only, no content).
#[tauri::command]
pub async fn staged_diff_text(state: State<'_, AppState>, id: i64) -> AppResult<String> {
    repo!(state, id, git, root, r);
    let raw = r.staged_diff_raw().await?;
    Ok(ai::prepare_diff(&String::from_utf8_lossy(&raw)).text)
}
