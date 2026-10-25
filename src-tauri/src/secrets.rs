//! API keys in the OS keychain (Secret Service / Windows Credential Manager).

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::settings::AiProviderKind;

const SERVICE: &str = "GitPilot";

fn account(p: AiProviderKind) -> &'static str {
    match p {
        AiProviderKind::OpenRouter => "ai-openrouter",
        // Claude Code uses its own sign-in; nothing is stored under this name.
        AiProviderKind::ClaudeCode => "ai-claude-code",
        AiProviderKind::Anthropic => "ai-anthropic",
        AiProviderKind::OpenAiCompatible => "ai-openai-compatible",
    }
}

fn env_vars(p: AiProviderKind) -> &'static [&'static str] {
    match p {
        AiProviderKind::OpenRouter => &["GITPILOT_AI_API_KEY", "OPENROUTER_API_KEY"],
        AiProviderKind::ClaudeCode => &[],
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

/// A secret GitPilot keeps: its keychain account, and the environment variables that can supply it.
#[derive(Clone, Copy)]
struct Slot {
    account: &'static str,
    env: &'static [&'static str],
}

fn ai_slot(p: AiProviderKind) -> Slot {
    Slot {
        account: account(p),
        env: env_vars(p),
    }
}

/// The GitHub sign-in (an OAuth or personal access token). `GH_TOKEN`/`GITHUB_TOKEN` follow the
/// GitHub CLI's convention.
const GITHUB: Slot = Slot {
    account: "github-token",
    env: &["GITPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
};

fn entry(slot: Slot) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, slot.account)
}

fn keychain_err(slot: Slot, e: keyring::Error) -> AppError {
    let var = slot.env.first().copied().unwrap_or("GITPILOT_AI_API_KEY");
    AppError::new(
        ErrorKind::Keychain,
        format!("The system keychain isn't available. On Linux this needs a Secret Service (e.g. GNOME Keyring or KWallet). You can set the {var} environment variable instead."),
    )
    .with_detail(e.to_string())
}

fn env_value(slot: Slot) -> Option<(&'static str, String)> {
    slot.env.iter().find_map(|v| {
        std::env::var(v)
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(|s| (*v, s.trim().to_string()))
    })
}

fn status_of(slot: Slot) -> KeyStatus {
    let env_var = env_value(slot).map(|(v, _)| v.to_string());
    match entry(slot).and_then(|e| e.get_password()) {
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

fn set_in(slot: Slot, secret: &str) -> AppResult<()> {
    entry(slot)
        .and_then(|e| e.set_password(secret))
        .map_err(|e| keychain_err(slot, e))
}

fn clear_in(slot: Slot) -> AppResult<()> {
    match entry(slot).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_err(slot, e)),
    }
}

/// Keychain first, then environment variables, with where it came from ("keychain" or the
/// variable's name). `None` if neither is set.
fn get_from(slot: Slot) -> Option<(String, String)> {
    if let Ok(k) = entry(slot).and_then(|e| e.get_password()) {
        if !k.trim().is_empty() {
            return Some((k.trim().to_string(), "keychain".to_string()));
        }
    }
    env_value(slot).map(|(v, k)| (k, v.to_string()))
}

pub fn status(p: AiProviderKind) -> KeyStatus {
    status_of(ai_slot(p))
}

pub fn set(p: AiProviderKind, key: &str) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::invalid("Paste an API key."));
    }
    if p == AiProviderKind::ClaudeCode {
        return Err(AppError::invalid(
            "Claude Code uses your Claude account, not an API key. Sign in from Settings → Claude Code.",
        ));
    }
    set_in(ai_slot(p), key)
}

pub fn clear(p: AiProviderKind) -> AppResult<()> {
    clear_in(ai_slot(p))
}

/// Keychain first, then environment variables. `None` if neither is set.
pub fn get(p: AiProviderKind) -> Option<String> {
    if p == AiProviderKind::ClaudeCode {
        return None;
    }
    get_from(ai_slot(p)).map(|(k, _)| k)
}

pub fn github_status() -> KeyStatus {
    status_of(GITHUB)
}

/// The GitHub token and where it came from ("keychain" or an environment variable's name).
pub fn github_token() -> Option<(String, String)> {
    get_from(GITHUB)
}

pub fn github_set(token: &str) -> AppResult<()> {
    set_in(GITHUB, token.trim())
}

pub fn github_clear() -> AppResult<()> {
    clear_in(GITHUB)
}
