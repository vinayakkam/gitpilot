//! Detects the Claude Code CLI and opens it in a terminal for a repository.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tokio::io::AsyncWriteExt;
use ts_rs::TS;

use crate::cli::{self, CliToolInfo};
use crate::error::{AppError, AppResult, ErrorKind};

/// Whether Claude Code is signed in to a Claude account (or otherwise has credentials).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeAuthStatus {
    /// Claude Code was found and answered; when false, `logged_in` is unknown.
    pub checked: bool,
    pub logged_in: bool,
    /// e.g. "claude.ai", "oauth_token", "api_key" — as reported by Claude Code.
    pub method: Option<String>,
    /// Why the status couldn't be read, if it couldn't.
    pub detail: Option<String>,
}

fn no_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Runs `claude auth status --json`.
pub async fn auth_status(claude: &Path) -> ClaudeAuthStatus {
    let mut cmd = tokio::process::Command::new(claude);
    cmd.args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    no_window(&mut cmd);
    let out = match tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return unknown_auth(e.to_string()),
        Err(_) => return unknown_auth("Claude Code didn't answer within 20 seconds.".into()),
    };
    parse_auth_status(&out.stdout, &out.stderr)
}

fn unknown_auth(detail: String) -> ClaudeAuthStatus {
    ClaudeAuthStatus {
        checked: false,
        logged_in: false,
        method: None,
        detail: Some(detail),
    }
}

pub fn parse_auth_status(stdout: &[u8], stderr: &[u8]) -> ClaudeAuthStatus {
    let text = String::from_utf8_lossy(stdout);
    let json = text
        .find('{')
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&text[s..]).ok());
    match json.as_ref().and_then(|j| j["loggedIn"].as_bool()) {
        Some(logged_in) => ClaudeAuthStatus {
            checked: true,
            logged_in,
            method: json
                .as_ref()
                .and_then(|j| j["authMethod"].as_str())
                .filter(|m| !m.is_empty() && *m != "none")
                .map(str::to_string),
            detail: None,
        },
        None => {
            let err = String::from_utf8_lossy(stderr);
            let msg = if err.contains("unknown command") || err.contains("Unknown command") {
                "This version of Claude Code can't report its sign-in status. Update Claude Code (claude update).".to_string()
            } else {
                format!("{}{}", text.trim(), err.trim())
                    .chars()
                    .take(400)
                    .collect()
            };
            unknown_auth(msg)
        }
    }
}

/// The instruction passed on the command line; the rules and the diff arrive on stdin.
const PRINT_INSTRUCTION: &str =
    "Follow the instructions at the top of the input and answer with the requested JSON only.";

/// Runs Claude Code non-interactively (`claude -p`) with no tools, in an empty folder, and
/// returns its text answer. Uses whatever account Claude Code is signed in with.
pub async fn print(claude: &Path, model: &str, input: &str) -> AppResult<String> {
    let work = std::env::temp_dir().join("gitpilot-claude");
    std::fs::create_dir_all(&work)?;
    let model = model.trim();
    let full: Vec<&str> = vec![
        "--tools",
        "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--disable-slash-commands",
    ];
    match run_print(claude, &work, model, input, &full).await? {
        PrintOutcome::Done(t) => Ok(t),
        // Older Claude Code versions don't know every flag; retry with the essentials.
        PrintOutcome::UnknownOption => match run_print(claude, &work, model, input, &[]).await? {
            PrintOutcome::Done(t) => Ok(t),
            PrintOutcome::UnknownOption => Err(AppError::new(
                ErrorKind::AiFailed,
                "This version of Claude Code is too old. Update it with `claude update`.",
            )),
        },
    }
}

enum PrintOutcome {
    Done(String),
    UnknownOption,
}

async fn run_print(
    claude: &Path,
    cwd: &Path,
    model: &str,
    input: &str,
    extra: &[&str],
) -> AppResult<PrintOutcome> {
    let mut cmd = tokio::process::Command::new(claude);
    cmd.args(["-p", PRINT_INSTRUCTION, "--output-format", "json"])
        .args(extra);
    if !model.is_empty() {
        cmd.args(["--model", model]);
    }
    cmd.current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(
            ErrorKind::ClaudeCodeNotFound,
            "Claude Code couldn't be started.",
        )
        .with_detail(e.to_string())
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).await?;
        drop(stdin);
    }
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(180),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| {
        AppError::new(
            ErrorKind::AiFailed,
            "Claude Code didn't finish within 3 minutes.",
        )
    })??;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() && stderr.to_ascii_lowercase().contains("unknown option") {
        return Ok(PrintOutcome::UnknownOption);
    }
    parse_print_output(&out.stdout, &stderr).map(PrintOutcome::Done)
}

/// Reads the `--output-format json` result object.
pub fn parse_print_output(stdout: &[u8], stderr: &str) -> AppResult<String> {
    let text = String::from_utf8_lossy(stdout);
    let json = text
        .find('{')
        .and_then(|s| serde_json::from_str::<serde_json::Value>(text[s..].trim()).ok());
    let Some(j) = json else {
        let all = format!("{}\n{}", text.trim(), stderr.trim());
        return Err(claude_error(all.trim()));
    };
    let result = j["result"].as_str().unwrap_or_default().to_string();
    if j["is_error"].as_bool().unwrap_or(false) || result.trim().is_empty() {
        let msg = if result.trim().is_empty() {
            format!("{} {}", j["subtype"].as_str().unwrap_or(""), stderr.trim())
        } else {
            result
        };
        return Err(claude_error(msg.trim()));
    }
    Ok(result)
}

fn claude_error(detail: &str) -> AppError {
    let lower = detail.to_ascii_lowercase();
    let detail: String = detail.chars().take(800).collect();
    if lower.contains("/login")
        || lower.contains("not logged in")
        || lower.contains("invalid api key")
        || lower.contains("log in")
        || lower.contains("oauth token has expired")
    {
        return AppError::new(
            ErrorKind::AiNotConfigured,
            "Claude Code isn't signed in. Sign in from Settings → Claude Code, then try again.",
        )
        .with_detail(detail);
    }
    if lower.contains("usage limit")
        || lower.contains("limit reached")
        || lower.contains("rate limit")
    {
        return AppError::new(
            ErrorKind::AiFailed,
            "Your Claude account has reached its usage limit for now. Try again later or switch provider in Settings → AI.",
        )
        .with_detail(detail);
    }
    AppError::new(
        ErrorKind::AiFailed,
        "Claude Code couldn't write a suggestion.",
    )
    .with_detail(detail)
}

fn known_locations() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = cli::home() {
        if cfg!(windows) {
            v.push(h.join(".local").join("bin").join("claude.exe"));
            v.push(h.join(".claude").join("local").join("claude.exe"));
        } else {
            v.push(h.join(".local").join("bin").join("claude"));
            v.push(h.join(".claude").join("local").join("claude"));
            v.push(h.join(".npm-global").join("bin").join("claude"));
        }
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
        }
    } else {
        v.push(PathBuf::from("/usr/local/bin/claude"));
        v.push(PathBuf::from("/usr/bin/claude"));
    }
    v
}

pub fn locate(configured: &str) -> Option<(PathBuf, &'static str)> {
    cli::locate(configured, "claude", known_locations())
}

pub async fn detect(configured: &str, terminal: &str) -> CliToolInfo {
    cli::detect(locate(configured), terminal).await
}

/// Opens Claude Code in a new terminal window with `repo` as its working directory.
/// The optional prompt is passed as a single argument (no shell is involved).
pub fn launch(claude: &Path, repo: &Path, prompt: Option<&str>, terminal: &str) -> AppResult<()> {
    if !repo.is_dir() {
        return Err(AppError::new(
            ErrorKind::PathNotFound,
            "The repository folder doesn't exist.",
        ));
    }
    let prompt = prompt.map(str::trim).filter(|p| !p.is_empty());
    cli::launch_in_terminal(
        claude,
        repo,
        prompt.as_slice(),
        terminal,
        "Claude Code",
        "claude",
    )
}

/// Opens `claude auth login` in a terminal so the user can sign in with their Claude account.
pub fn launch_login(claude: &Path, terminal: &str) -> AppResult<()> {
    let dir = cli::home()
        .filter(|h| h.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    cli::launch_in_terminal(
        claude,
        &dir,
        &["auth", "login"],
        terminal,
        "Claude Code",
        "claude auth login",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_auth_status() {
        let s = parse_auth_status(
            br#"{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty"}"#,
            b"",
        );
        assert!(s.checked && s.logged_in);
        assert_eq!(s.method.as_deref(), Some("claude.ai"));
        let s = parse_auth_status(br#"{"loggedIn": false, "authMethod": "none"}"#, b"");
        assert!(s.checked && !s.logged_in && s.method.is_none());
        let s = parse_auth_status(b"", b"error: unknown command 'auth'");
        assert!(!s.checked);
        assert!(s.detail.unwrap().contains("Update Claude Code"));
    }

    #[test]
    fn reads_print_output() {
        let ok = br#"{"type":"result","subtype":"success","is_error":false,"result":"{\"suggestions\":[]}"}"#;
        assert_eq!(parse_print_output(ok, "").unwrap(), "{\"suggestions\":[]}");
        let login = br#"{"type":"result","is_error":true,"result":"Invalid API key \u00b7 Please run /login"}"#;
        let e = parse_print_output(login, "").unwrap_err();
        assert_eq!(e.kind, ErrorKind::AiNotConfigured);
        let limit = br#"{"is_error":true,"result":"Claude AI usage limit reached|1700000000"}"#;
        assert!(parse_print_output(limit, "")
            .unwrap_err()
            .message
            .contains("usage limit"));
        let junk = parse_print_output(b"Segmentation fault", "").unwrap_err();
        assert_eq!(junk.kind, ErrorKind::AiFailed);
    }
}
