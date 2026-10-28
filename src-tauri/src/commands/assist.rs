use tauri::State;

use super::changes::repo;
use super::ctx;
use serde::Deserialize;
use ts_rs::TS;

use crate::ai::{
    self, AiSuggestions, AiText, ConflictHelp, OpenRouterKeyInfo, OpenRouterModel, PrDescription,
};
use crate::claude_code::{self, ClaudeAuthStatus};
use crate::cli::CliToolInfo;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::status::Area;
use crate::git::Repo;
use crate::opencode;
use crate::secrets;
use crate::settings::{AiProviderKind, AssistantTool, Settings};
use crate::state::AppState;

/// Settings, API key and Claude Code path for an AI request, once the privacy notice was accepted.
fn ai_ctx(state: &AppState) -> AppResult<(Settings, Option<String>, Option<std::path::PathBuf>)> {
    let s = state.settings();
    if !s.ai.privacy_acknowledged {
        return Err(AppError::new(
            ErrorKind::AiNotConfigured,
            "Review the privacy notice in Settings → AI before sending code to an AI provider.",
        ));
    }
    let key = secrets::get(s.ai.provider);
    let claude = claude_code::locate(&s.claude_code.path).map(|(p, _)| p);
    Ok((s, key, claude))
}

#[tauri::command]
pub async fn ai_suggest_commit(state: State<'_, AppState>, id: i64) -> AppResult<AiSuggestions> {
    let (s, key, claude) = ai_ctx(&state)?;
    repo!(state, id, git, root, r);
    let raw = r.staged_diff_raw().await?;
    let raw = String::from_utf8_lossy(&raw).into_owned();
    ai::suggest(&s.ai, s.commit_convention, key, claude, &raw).await
}

/// What to explain: a commit, or one file's uncommitted changes.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum ExplainTarget {
    Commit {
        hash: String,
    },
    #[serde(rename_all = "camelCase")]
    Change {
        path: String,
        area: Area,
        orig_path: Option<String>,
    },
    /// A GitHub pull request: its title, description and changed files.
    PullRequest {
        owner: String,
        name: String,
        number: u32,
    },
}

#[tauri::command]
pub async fn ai_explain(
    state: State<'_, AppState>,
    id: i64,
    target: ExplainTarget,
) -> AppResult<AiText> {
    let (s, key, claude) = ai_ctx(&state)?;
    repo!(state, id, git, root, r);
    let (what, raw) = match &target {
        ExplainTarget::Commit { hash } => {
            let d = r.commit_detail(hash).await?;
            (
                format!("Commit {}: {}", d.summary.short_hash, d.message),
                r.commit_diff_raw(hash).await?,
            )
        }
        ExplainTarget::Change {
            path,
            area,
            orig_path,
        } => (
            format!(
                "{} changes to {path}",
                if *area == Area::Staged {
                    "Staged"
                } else {
                    "Uncommitted"
                }
            ),
            r.change_diff_raw(path, *area, orig_path.as_deref()).await?,
        ),
        ExplainTarget::PullRequest {
            owner,
            name,
            number,
        } => {
            let token = crate::secrets::github_token()
                .map(|(t, _)| t)
                .ok_or_else(crate::github::not_signed_in)?;
            let d = crate::github_pr::detail(&token, owner, name, *number).await?;
            (
                format!("Pull request #{number}: {}\n\n{}", d.title, d.body),
                crate::github_pr::diff_text(&token, owner, name, *number)
                    .await?
                    .into_bytes(),
            )
        }
    };
    ai::explain(&s.ai, key, claude, &what, &String::from_utf8_lossy(&raw)).await
}

/// Title and description for a pull request of HEAD into `base` (e.g. "origin/main").
#[tauri::command]
pub async fn ai_pr_description(
    state: State<'_, AppState>,
    id: i64,
    base: String,
) -> AppResult<PrDescription> {
    let (s, key, claude) = ai_ctx(&state)?;
    repo!(state, id, git, root, r);
    let (commits, raw) = r.branch_changes_since(&base).await?;
    ai::pr_description(&s.ai, key, claude, &commits, &String::from_utf8_lossy(&raw)).await
}

/// Suggested resolutions for the conflicts in one file. Changes nothing.
#[tauri::command]
pub async fn ai_conflict_help(
    state: State<'_, AppState>,
    id: i64,
    path: String,
) -> AppResult<ConflictHelp> {
    let (s, key, claude) = ai_ctx(&state)?;
    repo!(state, id, git, root, r);
    let blocks = r.conflict_blocks(&path).await?;
    ai::conflict_help(&s.ai, key, claude, &path, &blocks).await
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
pub async fn claude_detect(state: State<'_, AppState>) -> AppResult<CliToolInfo> {
    let s = state.settings();
    Ok(claude_code::detect(&s.claude_code.path, &s.claude_code.terminal).await)
}

#[tauri::command]
pub async fn opencode_detect(state: State<'_, AppState>) -> AppResult<CliToolInfo> {
    let s = state.settings();
    Ok(opencode::detect(&s.opencode.path, &s.claude_code.terminal).await)
}

/// Opens the coding assistant chosen in Settings (Claude Code or OpenCode) in a terminal in the
/// repository, optionally with a first prompt.
#[tauri::command]
pub async fn assistant_launch(
    state: State<'_, AppState>,
    id: i64,
    prompt: Option<String>,
) -> AppResult<()> {
    let s = state.settings();
    let root = state.repo_path(id)?;
    let terminal = &s.claude_code.terminal;
    match s.assistant_tool {
        AssistantTool::ClaudeCode => {
            let (path, _) = claude_code::locate(&s.claude_code.path).ok_or_else(not_found)?;
            claude_code::launch(&path, &root, prompt.as_deref(), terminal)
        }
        AssistantTool::OpenCode => {
            let (path, _) = opencode::locate(&s.opencode.path).ok_or_else(opencode::not_found)?;
            opencode::launch(&path, &root, prompt.as_deref(), terminal)
        }
    }
}

/// Staged diff stats for prompt templates (counts only, no content).
#[tauri::command]
pub async fn staged_diff_text(state: State<'_, AppState>, id: i64) -> AppResult<String> {
    repo!(state, id, git, root, r);
    let raw = r.staged_diff_raw().await?;
    Ok(ai::prepare_diff(&String::from_utf8_lossy(&raw)).text)
}
