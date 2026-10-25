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
    /// OpenRouter: one key for models from many labs. The default.
    OpenRouter,
    /// The Claude Code CLI, signed in with the user's Claude account (no API key).
    ClaudeCode,
    Anthropic,
    OpenAiCompatible,
}

impl AiProviderKind {
    /// Model used when the user switches to this provider.
    pub fn default_model(self) -> &'static str {
        match self {
            AiProviderKind::OpenRouter => DEFAULT_OPENROUTER_MODEL,
            AiProviderKind::ClaudeCode => "haiku",
            AiProviderKind::Anthropic => "claude-haiku-5-5",
            AiProviderKind::OpenAiCompatible => "",
        }
    }
}

/// OpenRouter's auto router picks a suitable model for each request.
pub const DEFAULT_OPENROUTER_MODEL: &str = "openrouter/auto";

/// Accent colours offered in Settings → Appearance. Custom colours are stored as `#rrggbb`.
pub const ACCENT_PRESETS: &[&str] = &[
    "blue", "indigo", "violet", "pink", "red", "orange", "amber", "green", "teal", "cyan", "slate",
];

pub const SETTINGS_VERSION: u32 = 2;

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
            provider: AiProviderKind::OpenRouter,
            model: DEFAULT_OPENROUTER_MODEL.into(),
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct GitHubSettings {
    /// Client ID of a GitHub OAuth app with device flow enabled, used for "Sign in with GitHub".
    /// Empty = the ID built into this version of GitPilot, if any.
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    /// Bumped when defaults change in a way existing settings files should pick up (see `migrate`).
    pub settings_version: u32,
    pub theme: Theme,
    /// Accent colour: a preset name from `ACCENT_PRESETS` or a custom `#rrggbb`.
    pub accent: String,
    pub density: Density,
    pub diff_mode: DiffMode,
    pub syntax_highlighting: bool,
    /// Explicit git executable; empty = auto-detect.
    pub git_path: String,
    /// Initial branch name used when GitPilot initializes a repository; empty = Git's default.
    pub default_branch: String,
    pub pull_strategy: PullStrategy,
    pub commit_convention: CommitConvention,
    /// Warn before committing files with Windows (CRLF) line endings into an LF repository.
    pub check_line_endings: bool,
    pub ai: AiSettings,
    pub claude_code: ClaudeCodeSettings,
    pub github: GitHubSettings,
    /// Reopen the last repository on startup.
    pub reopen_last_repo: bool,
    /// Refresh the file list as soon as files change on disk.
    pub auto_refresh: bool,
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
            // Missing in files written before versioning; `migrate` brings them up to date.
            settings_version: 0,
            theme: Theme::System,
            accent: "blue".into(),
            density: Density::Comfortable,
            diff_mode: DiffMode::Unified,
            syntax_highlighting: true,
            git_path: String::new(),
            default_branch: String::new(),
            pull_strategy: PullStrategy::FfOnly,
            commit_convention: CommitConvention::None,
            check_line_endings: true,
            ai: AiSettings::default(),
            claude_code: ClaudeCodeSettings::default(),
            github: GitHubSettings::default(),
            reopen_last_repo: true,
            auto_refresh: true,
            success_notifications: true,
            check_for_updates: true,
            last_repo_id: None,
        }
    }
}

pub fn is_valid_accent(a: &str) -> bool {
    ACCENT_PRESETS.contains(&a)
        || (a.len() == 7 && a.starts_with('#') && a[1..].chars().all(|c| c.is_ascii_hexdigit()))
}

impl Settings {
    /// Upgrades settings written by older versions.
    pub fn migrate(&mut self) {
        if self.settings_version < 2 {
            // 0.3.0 made OpenRouter the default AI provider. Switch people who never set AI up
            // (still on the old Anthropic default, never enabled); keep anyone who configured it.
            let ai = &self.ai;
            if !ai.enabled
                && !ai.privacy_acknowledged
                && ai.provider == AiProviderKind::Anthropic
                && ai.model == "claude-haiku-5-5"
                && ai.base_url.is_empty()
            {
                self.ai.provider = AiProviderKind::OpenRouter;
                self.ai.model = DEFAULT_OPENROUTER_MODEL.into();
            }
        }
        if !is_valid_accent(&self.accent) {
            self.accent = "blue".into();
        }
        self.settings_version = SETTINGS_VERSION;
    }

    pub fn validate(&self) -> AppResult<()> {
        if !is_valid_accent(&self.accent) {
            return Err(AppError::invalid(
                "Choose one of the accent colours or enter a colour like #3550c8.",
            ));
        }
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
        let id = self.github.client_id.trim();
        if !id.is_empty() && !crate::github::is_valid_client_id(id) {
            return Err(AppError::invalid(
                "That doesn't look like a GitHub client ID. Copy it from your OAuth app's settings page.",
            ));
        }
        if self.ai.model.trim().is_empty()
            && self.ai.enabled
            && self.ai.provider != AiProviderKind::ClaudeCode
        {
            return Err(AppError::invalid("Enter a model name."));
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Settings {
    let mut s = load_raw(path);
    s.migrate();
    s
}

fn load_raw(path: &Path) -> Settings {
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
    fn migrates_untouched_ai_settings_to_openrouter() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        // A 0.2.x file with AI never set up.
        std::fs::write(
            &p,
            r#"{"theme":"dark","ai":{"enabled":false,"provider":"anthropic","model":"claude-haiku-5-5","baseUrl":"","includeBody":true,"privacyAcknowledged":false}}"#,
        )
        .unwrap();
        let s = load(&p);
        assert_eq!(s.ai.provider, AiProviderKind::OpenRouter);
        assert_eq!(s.ai.model, DEFAULT_OPENROUTER_MODEL);
        assert_eq!(s.accent, "blue");
        assert!(s.check_line_endings);
        assert_eq!(s.settings_version, SETTINGS_VERSION);

        // Someone who configured Anthropic keeps it.
        std::fs::write(
            &p,
            r#"{"ai":{"enabled":true,"provider":"anthropic","model":"claude-haiku-5-5","privacyAcknowledged":true}}"#,
        )
        .unwrap();
        assert_eq!(load(&p).ai.provider, AiProviderKind::Anthropic);

        // A migrated file is not migrated again.
        let mut s = Settings::default();
        s.migrate();
        s.ai.provider = AiProviderKind::Anthropic;
        s.ai.model = "claude-haiku-5-5".into();
        save(&p, &s).unwrap();
        assert_eq!(load(&p).ai.provider, AiProviderKind::Anthropic);
    }

    #[test]
    fn accent_validation() {
        assert!(is_valid_accent("blue"));
        assert!(is_valid_accent("#12abEF"));
        assert!(!is_valid_accent("#12ab"));
        assert!(!is_valid_accent("url(x)"));
        let s = Settings {
            accent: "nope".into(),
            ..Settings::default()
        };
        assert!(s.validate().is_err());
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
