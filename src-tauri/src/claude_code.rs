//! Detects the Claude Code CLI and opens it in a terminal for a repository.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeCodeInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// "settings", "path" or "known location".
    pub source: Option<String>,
    /// Linux: the terminal that would be used (if one was found).
    pub terminal: Option<String>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn known_locations() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = home() {
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
    let c = configured.trim();
    if !c.is_empty() {
        let p = PathBuf::from(c);
        return p.is_file().then_some((p, "settings"));
    }
    if let Ok(p) = which::which("claude") {
        return Some((p, "path"));
    }
    known_locations()
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| (p, "known location"))
}

pub async fn detect(configured: &str, terminal: &str) -> ClaudeCodeInfo {
    let term = if cfg!(windows) {
        None
    } else {
        find_terminal(terminal).map(|(t, _)| t.display().to_string())
    };
    let Some((path, source)) = locate(configured) else {
        return ClaudeCodeInfo {
            found: false,
            path: None,
            version: None,
            source: None,
            terminal: term,
        };
    };
    let mut cmd = tokio::process::Command::new(&path);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let version = match tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await
    {
        Ok(Ok(o)) if o.status.success() => {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
        }
        _ => None,
    };
    ClaudeCodeInfo {
        found: true,
        path: Some(path.display().to_string()),
        version,
        source: Some(source.to_string()),
        terminal: term,
    }
}

/// How each known terminal expects "run this program with these arguments".
fn exec_flag(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "gnome-terminal" | "kgx" | "ptyxis" | "tilix" => &["--"],
        "konsole"
        | "xterm"
        | "alacritty"
        | "terminator"
        | "urxvt"
        | "rxvt"
        | "st"
        | "lxterminal"
        | "mate-terminal"
        | "qterminal"
        | "deepin-terminal"
        | "x-terminal-emulator" => &["-e"],
        "xfce4-terminal" => &["-x"],
        "wezterm" => &["start", "--"],
        "kitty" | "foot" | "ghostty" => &[],
        _ => return None,
    })
}

fn find_terminal(configured: &str) -> Option<(PathBuf, &'static [&'static str])> {
    let mut names: Vec<String> = Vec::new();
    if !configured.trim().is_empty() {
        names.push(configured.trim().to_string());
    }
    if let Ok(t) = std::env::var("TERMINAL") {
        names.push(t);
    }
    for n in [
        "x-terminal-emulator",
        "gnome-terminal",
        "kgx",
        "ptyxis",
        "konsole",
        "xfce4-terminal",
        "kitty",
        "alacritty",
        "wezterm",
        "foot",
        "ghostty",
        "tilix",
        "terminator",
        "mate-terminal",
        "lxterminal",
        "qterminal",
        "xterm",
    ] {
        names.push(n.to_string());
    }
    for n in names {
        let p = if Path::new(&n).is_absolute() {
            Some(PathBuf::from(&n))
        } else {
            which::which(&n).ok()
        };
        if let Some(p) = p.filter(|p| p.is_file()) {
            let base = p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            // Unknown custom terminals get "-e", the most widely supported convention.
            let flag = exec_flag(&base).unwrap_or(&["-e"]);
            return Some((p, flag));
        }
    }
    None
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

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        let _ = terminal;
        let mut cmd = Command::new(claude);
        if let Some(p) = prompt {
            cmd.arg(p);
        }
        cmd.current_dir(repo).creation_flags(CREATE_NEW_CONSOLE);
        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(ErrorKind::LaunchFailed, "Claude Code couldn't be started.")
                .with_detail(e.to_string())
        })?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let (term, flag) = find_terminal(terminal).ok_or_else(|| {
            AppError::new(
                ErrorKind::LaunchFailed,
                "No terminal emulator was found. Set one in Settings → Claude Code, or copy the prompt and run `claude` yourself.",
            )
        })?;
        let mut cmd = Command::new(&term);
        cmd.args(flag).arg(claude);
        if let Some(p) = prompt {
            cmd.arg(p);
        }
        cmd.current_dir(repo)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(ErrorKind::LaunchFailed, "The terminal couldn't be started.")
                .with_detail(format!("{}: {e}", term.display()))
        })?;
        // Reap the process when it exits so it doesn't linger as a zombie.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}
