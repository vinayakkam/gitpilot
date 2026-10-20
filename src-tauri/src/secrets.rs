//! API keys in the OS keychain (Secret Service / Windows Credential Manager).

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::settings::AiProviderKind;

const SERVICE: &str = "GitPilot";

fn account(p: AiProviderKind) -> &'static str {
    match p {
        AiProviderKind::Anthropic => "ai-anthropic",
        AiProviderKind::OpenAiCompatible => "ai-openai-compatible",
    }
}

fn env_vars(p: AiProviderKind) -> &'static [&'static str] {
    match p {
        AiProviderKind::Anthropic => &["GITPILOT_AI_API_KEY", "ANTHROPIC_API_KEY"],
        AiProviderKind::OpenAiCompatible => &["GITPILOT_AI_API_KEY", "OPENAI_API_KEY"],
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KeyStatus {
    /// A key is stored in the OS keychain.
    pub stored: bool,
    /// Name of an environment variable that supplies a key, if one is set.
    pub env_var: Option<String>,
    /// The OS keychain could be reached.
    pub keychain_available: bool,
    pub keychain_error: Option<String>,
}

fn entry(p: AiProviderKind) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, account(p))
}

fn keychain_err(e: keyring::Error) -> AppError {
    AppError::new(
        ErrorKind::Keychain,
        "The system keychain isn't available. On Linux this needs a Secret Service (e.g. GNOME Keyring or KWallet). You can set the GITPILOT_AI_API_KEY environment variable instead.",
    )
    .with_detail(e.to_string())
}

pub fn status(p: AiProviderKind) -> KeyStatus {
    let env_var = env_vars(p)
        .iter()
        .find(|v| {
            std::env::var(v)
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        })
        .map(|s| s.to_string());
    match entry(p).and_then(|e| e.get_password()) {
        Ok(_) => KeyStatus {
            stored: true,
            env_var,
            keychain_available: true,
            keychain_error: None,
        },
        Err(keyring::Error::NoEntry) => KeyStatus {
            stored: false,
            env_var,
            keychain_available: true,
            keychain_error: None,
        },
        Err(e) => KeyStatus {
            stored: false,
            env_var,
            keychain_available: false,
            keychain_error: Some(e.to_string()),
        },
    }
}

pub fn set(p: AiProviderKind, key: &str) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::invalid("Paste an API key."));
    }
    entry(p)
        .and_then(|e| e.set_password(key))
        .map_err(keychain_err)
}

pub fn clear(p: AiProviderKind) -> AppResult<()> {
    match entry(p).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_err(e)),
    }
}

/// Keychain first, then environment variables. `None` if neither is set.
pub fn get(p: AiProviderKind) -> Option<String> {
    if let Ok(k) = entry(p).and_then(|e| e.get_password()) {
        if !k.trim().is_empty() {
            return Some(k);
        }
    }
    env_vars(p)
        .iter()
        .find_map(|v| std::env::var(v).ok().filter(|s| !s.trim().is_empty()))
}
