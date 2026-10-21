use tauri::State;

use super::changes::repo;
use super::ctx;
use crate::ai::{self, AiSuggestions, OpenRouterKeyInfo, OpenRouterModel};
use crate::claude_code::{self, ClaudeAuthStatus, ClaudeCodeInfo};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::Repo;
use crate::secrets;
use crate::settings::AiProviderKind;
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
    let claude = claude_code::locate(&s.claude_code.path).map(|(p, _)| p);
    ai::suggest(&s.ai, s.commit_convention, key, claude, &raw).await
}

/// Whether Claude Code is signed in to a Claude account.
#[tauri::command]
pub async fn claude_auth_status(state: State<'_, AppState>) -> AppResult<ClaudeAuthStatus> {
    let s = state.settings();
    let (path, _) = claude_code::locate(&s.claude_code.path).ok_or_else(not_found)?;
    Ok(claude_code::auth_status(&path).await)
}

/// Opens Claude Code's sign-in (`claude auth login`) in a terminal window.
#[tauri::command]
pub async fn claude_login(state: State<'_, AppState>) -> AppResult<()> {
    let s = state.settings();
    let (path, _) = claude_code::locate(&s.claude_code.path).ok_or_else(not_found)?;
    claude_code::launch_login(&path, &s.claude_code.terminal)
}

fn not_found() -> AppError {
    AppError::new(
        ErrorKind::ClaudeCodeNotFound,
        "Claude Code isn't installed or couldn't be found. Install it (see docs.claude.com) or set its path in Settings → Claude Code.",
    )
}

/// Models available on OpenRouter (public list; the key is sent when one is saved).
#[tauri::command]
pub async fn openrouter_models(state: State<'_, AppState>) -> AppResult<Vec<OpenRouterModel>> {
    let s = state.settings();
    ai::openrouter_models(&s.ai, secrets::get(AiProviderKind::OpenRouter)).await
}

/// Verifies the saved OpenRouter key and reports its usage.
#[tauri::command]
pub async fn openrouter_key_info(state: State<'_, AppState>) -> AppResult<OpenRouterKeyInfo> {
    let s = state.settings();
    ai::openrouter_key_info(&s.ai, secrets::get(AiProviderKind::OpenRouter)).await
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
    let (path, _) = claude_code::locate(&s.claude_code.path).ok_or_else(not_found)?;
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
