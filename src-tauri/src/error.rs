//! Application error type shared by every Tauri command.
//!
//! Serialized as `{ kind, message, detail }`. `kind` is a stable code the UI can switch on,
//! `message` is a plain-language explanation, `detail` is (redacted) technical output.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    GitNotFound,
    NotARepository,
    PathNotFound,
    InvalidInput,
    MissingIdentity,
    NothingToCommit,
    EmptyMessage,
    HookFailed,
    SigningFailed,
    Conflict,
    Locked,
    AuthFailed,
    NetworkFailed,
    PushRejected,
    NoUpstream,
    LocalChangesWouldBeOverwritten,
    BranchNotMerged,
    AlreadyExists,
    PermissionDenied,
    Timeout,
    Database,
    Settings,
    AiNotConfigured,
    AiFailed,
    ClaudeCodeNotFound,
    LaunchFailed,
    Keychain,
    Git,
    Internal,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let d = detail.into();
        if !d.trim().is_empty() {
            self.detail = Some(crate::git::redact::redact_text(d.trim()));
        }
        self
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " ({d})")?;
        }
        Ok(())
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::new(
            ErrorKind::Database,
            "GitPilot could not read or write its local database.",
        )
        .with_detail(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let kind = match e.kind() {
            std::io::ErrorKind::PermissionDenied => ErrorKind::PermissionDenied,
            std::io::ErrorKind::NotFound => ErrorKind::PathNotFound,
            _ => ErrorKind::Internal,
        };
        let msg = match kind {
            ErrorKind::PermissionDenied => "Permission denied.",
            ErrorKind::PathNotFound => "The file or folder could not be found.",
            _ => "A file system operation failed.",
        };
        AppError::new(kind, msg).with_detail(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
