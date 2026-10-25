//! Tauri command handlers. Keep these thin: validate, resolve the repo, delegate.

pub mod app;
pub mod assist;
pub mod branches;
pub mod changes;
pub mod github;
pub mod history;
pub mod remotes;
pub mod repos;
pub mod signing;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::error::AppResult;
use crate::git::Git;
use crate::state::AppState;

pub(crate) fn ctx(state: &AppState, repo_id: i64) -> AppResult<(Git, PathBuf)> {
    Ok((state.git()?, state.repo_path(repo_id)?))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressEvent {
    #[ts(type = "number | null")]
    pub repo_id: Option<i64>,
    pub op: String,
    pub line: String,
}

pub(crate) fn progress(
    app: &AppHandle,
    repo_id: Option<i64>,
    op: &'static str,
) -> impl FnMut(String) + Send {
    let app = app.clone();
    move |line: String| {
        let _ = app.emit(
            "git-progress",
            ProgressEvent {
                repo_id,
                op: op.to_string(),
                line,
            },
        );
    }
}
