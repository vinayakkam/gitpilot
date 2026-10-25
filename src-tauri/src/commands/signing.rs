//! Commit signing setup and signature checks.

use tauri::State;

use super::changes::repo;
use super::ctx;
use crate::error::AppResult;
use crate::git::signing::{self, Signature, SigningConfig, SigningFormat, SigningScope};
use crate::git::Repo;
use crate::signing_keys::{self, SigningKey};
use crate::state::AppState;

/// The signing setup in effect for repository `id`, or the global one when `id` is `None`.
#[tauri::command]
pub async fn signing_get(state: State<'_, AppState>, id: Option<i64>) -> AppResult<SigningConfig> {
    match id {
        Some(id) => {
            repo!(state, id, git, root, r);
            r.signing_config().await
        }
        None => signing::global_config(&state.git()?).await,
    }
}

/// SSH and GPG keys on this computer that can sign commits.
#[tauri::command]
pub async fn signing_keys(state: State<'_, AppState>) -> AppResult<Vec<SigningKey>> {
    Ok(signing_keys::list(state.git()?.exe()).await)
}

/// Turns on signing with `key`, for every repository (`Global`) or only repository `id`.
#[tauri::command]
pub async fn signing_enable(
    state: State<'_, AppState>,
    id: Option<i64>,
    scope: SigningScope,
    format: SigningFormat,
    key: String,
) -> AppResult<SigningConfig> {
    let git = state.git()?;
    let root = id.map(|i| state.repo_path(i)).transpose()?;
    let allowed = state.data_dir.join("allowed_signers");
    signing::enable(&git, root.as_deref(), scope, format, &key, &allowed).await?;
    signing_get(state, id).await
}

#[tauri::command]
pub async fn signing_disable(
    state: State<'_, AppState>,
    id: Option<i64>,
    scope: SigningScope,
) -> AppResult<SigningConfig> {
    let git = state.git()?;
    let root = id.map(|i| state.repo_path(i)).transpose()?;
    signing::disable(&git, root.as_deref(), scope).await?;
    signing_get(state, id).await
}

/// Whether a commit is signed, by whom, and whether the signature checks out.
#[tauri::command]
pub async fn commit_signature(
    state: State<'_, AppState>,
    id: i64,
    hash: String,
) -> AppResult<Signature> {
    repo!(state, id, git, root, r);
    r.signature(&hash).await
}
