//! Detects the OpenCode CLI (opencode.ai) and opens it in a terminal for a repository.

use std::path::{Path, PathBuf};

use crate::cli::{self, CliToolInfo};
use crate::error::{AppError, AppResult, ErrorKind};

fn known_locations() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = cli::home() {
        if cfg!(windows) {
            v.push(h.join(".opencode").join("bin").join("opencode.exe"));
            v.push(h.join("scoop").join("shims").join("opencode.exe"));
        } else {
            // The install script (opencode.ai/install) puts it here.
            v.push(h.join(".opencode").join("bin").join("opencode"));
            v.push(h.join(".local").join("bin").join("opencode"));
            v.push(h.join(".npm-global").join("bin").join("opencode"));
            v.push(h.join(".bun").join("bin").join("opencode"));
        }
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(appdata).join("npm").join("opencode.cmd"));
        }
    } else {
        v.push(PathBuf::from("/usr/local/bin/opencode"));
        v.push(PathBuf::from("/usr/bin/opencode"));
        v.push(PathBuf::from("/opt/homebrew/bin/opencode"));
    }
    v
}

pub fn locate(configured: &str) -> Option<(PathBuf, &'static str)> {
    cli::locate(configured, "opencode", known_locations())
}

pub async fn detect(configured: &str, terminal: &str) -> CliToolInfo {
    cli::detect(locate(configured), terminal).await
}

/// Arguments that start OpenCode's TUI, with `prompt` as its first message (`--prompt`).
pub fn launch_args(prompt: Option<&str>) -> Vec<&str> {
    match prompt.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => vec!["--prompt", p],
        None => Vec::new(),
    }
}

/// Opens OpenCode in a new terminal window with `repo` as its working directory.
pub fn launch(opencode: &Path, repo: &Path, prompt: Option<&str>, terminal: &str) -> AppResult<()> {
    if !repo.is_dir() {
        return Err(AppError::new(
            ErrorKind::PathNotFound,
            "The repository folder doesn't exist.",
        ));
    }
    cli::launch_in_terminal(
        opencode,
        repo,
        &launch_args(prompt),
        terminal,
        "OpenCode",
        "opencode",
    )
}

pub fn not_found() -> AppError {
    AppError::new(
        ErrorKind::LaunchFailed,
        "OpenCode isn't installed or couldn't be found. Install it (see opencode.ai/docs) or set its path in Settings → Coding assistant.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_is_one_argument() {
        assert_eq!(
            launch_args(Some(" Fix it\nplease ")),
            vec!["--prompt", "Fix it\nplease"]
        );
        assert!(launch_args(Some("  ")).is_empty());
        assert!(launch_args(None).is_empty());
    }

    #[test]
    fn settings_path_wins_and_must_exist() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("opencode");
        std::fs::write(&exe, "").unwrap();
        let found = locate(exe.to_str().unwrap()).unwrap();
        assert_eq!((found.0, found.1), (exe.clone(), "settings"));
        assert!(locate(dir.path().join("missing").to_str().unwrap()).is_none());
    }
}
