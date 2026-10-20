//! Typed application settings stored as JSON in the app config directory.
//! Secrets (API keys) are NOT stored here — see `secrets.rs`.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::repo::PullStrategy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Density {
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DiffMode {
    Unified,
    Split,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CommitConvention {
    None,
    Conventional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiProviderKind {
    Anthropic,
    OpenAiCompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AiSettings {
    /// External AI processing is opt-in.
    pub enabled: bool,
    pub provider: AiProviderKind,
    pub model: String,
    /// Base URL for OpenAI-compatible providers, e.g. https://api.openai.com/v1 or http://localhost:11434/v1
    pub base_url: String,
    /// Ask for a body paragraph in addition to the subject line.
    pub include_body: bool,
    /// The user has read the privacy notice about sending staged diffs.
    pub privacy_acknowledged: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AiProviderKind::Anthropic,
            model: "claude-haiku-5-5".into(),
            base_url: String::new(),
            include_body: true,
            privacy_acknowledged: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ClaudeCodeSettings {
    /// Explicit path to the `claude` executable; empty = auto-detect.
    pub path: String,
    /// Linux only: terminal emulator executable to launch Claude Code in; empty = auto.
    pub terminal: String,
    /// Include the selected prompt as Claude Code's initial message when launching.
    pub send_prompt_on_launch: bool,
}

impl Default for ClaudeCodeSettings {
    fn default() -> Self {
        Self {
            path: String::new(),
            terminal: String::new(),
            send_prompt_on_launch: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub theme: Theme,
    pub density: Density,
    pub diff_mode: DiffMode,
    pub syntax_highlighting: bool,
    /// Explicit git executable; empty = auto-detect.
    pub git_path: String,
    /// Initial branch name used when GitPilot initializes a repository; empty = Git's default.
    pub default_branch: String,
    pub pull_strategy: PullStrategy,
    pub commit_convention: CommitConvention,
    pub ai: AiSettings,
    pub claude_code: ClaudeCodeSettings,
    /// Reopen the last repository on startup.
    pub reopen_last_repo: bool,
    /// Show a notification when operations succeed (errors are always shown).
    pub success_notifications: bool,
    /// Look for a new version on startup (at most once a day).
    pub check_for_updates: bool,
    #[ts(type = "number | null")]
    pub last_repo_id: Option<i64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            density: Density::Comfortable,
            diff_mode: DiffMode::Unified,
            syntax_highlighting: true,
            git_path: String::new(),
            default_branch: String::new(),
            pull_strategy: PullStrategy::FfOnly,
            commit_convention: CommitConvention::None,
            ai: AiSettings::default(),
            claude_code: ClaudeCodeSettings::default(),
            reopen_last_repo: true,
            success_notifications: true,
            check_for_updates: true,
            last_repo_id: None,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> AppResult<()> {
        let b = self.default_branch.trim();
        if !b.is_empty() {
            crate::git::validate::ref_name(b)?;
        }
        if self.ai.provider == AiProviderKind::OpenAiCompatible && self.ai.enabled {
            let u = self.ai.base_url.trim();
            if !(u.starts_with("https://") || u.starts_with("http://")) {
                return Err(AppError::invalid("Enter the provider's base URL, starting with https:// (or http:// for a local server)."));
            }
        }
        if self.ai.model.trim().is_empty() && self.ai.enabled {
            return Err(AppError::invalid("Enter a model name."));
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| {
            // Keep the unreadable file for inspection instead of silently losing it.
            let _ = std::fs::rename(path, path.with_extension("json.invalid"));
            Settings::default()
        }),
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, s: &Settings) -> AppResult<()> {
    let json = serde_json::to_string_pretty(s).map_err(|e| {
        AppError::new(ErrorKind::Settings, "Settings couldn't be saved.").with_detail(e.to_string())
    })?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Write-then-rename so a crash never leaves a half-written file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_tolerates_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let s = Settings {
            theme: Theme::Dark,
            ai: AiSettings {
                model: "x".into(),
                ..AiSettings::default()
            },
            ..Settings::default()
        };
        save(&p, &s).unwrap();
        let back = load(&p);
        assert_eq!(back.theme, Theme::Dark);
        assert_eq!(back.ai.model, "x");

        std::fs::write(&p, r#"{"theme":"light","unknownField":1}"#).unwrap();
        let partial = load(&p);
        assert_eq!(partial.theme, Theme::Light);
        assert_eq!(partial.pull_strategy, PullStrategy::FfOnly);
    }

    #[test]
    fn corrupt_file_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, "{not json").unwrap();
        let s = load(&p);
        assert_eq!(s.theme, Theme::System);
        assert!(p.with_extension("json.invalid").exists());
    }
}
