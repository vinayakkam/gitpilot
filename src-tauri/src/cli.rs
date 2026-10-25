//! Interactive command-line tools (Claude Code, OpenCode): finding a terminal, reading a
//! tool's version, and opening the tool in a terminal window. No shell is ever involved.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

/// Whether a command-line tool was found, and the terminal it would open in.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CliToolInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// "settings", "path" or "known location".
    pub source: Option<String>,
    /// Linux: the terminal that would be used (if one was found).
    pub terminal: Option<String>,
}

pub fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// First of `configured` (must exist), the PATH entry for `name`, then `known` locations.
pub fn locate(
    configured: &str,
    name: &str,
    known: Vec<PathBuf>,
) -> Option<(PathBuf, &'static str)> {
    let c = configured.trim();
    if !c.is_empty() {
        let p = PathBuf::from(c);
        return p.is_file().then_some((p, "settings"));
    }
    if let Ok(p) = which::which(name) {
        return Some((p, "path"));
    }
    known
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| (p, "known location"))
}

/// Finds a tool and reads its version (`--version`, at most 10 s).
pub async fn detect(found: Option<(PathBuf, &'static str)>, terminal: &str) -> CliToolInfo {
    let term = if cfg!(windows) {
        None
    } else {
        find_terminal(terminal).map(|(t, _)| t.display().to_string())
    };
    let Some((path, source)) = found else {
        return CliToolInfo {
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
    CliToolInfo {
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

pub fn find_terminal(configured: &str) -> Option<(PathBuf, &'static [&'static str])> {
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

/// Opens `program args…` in a new terminal window (a new console on Windows) in `cwd`.
/// `tool` names it in error messages, e.g. "Claude Code"; `command` is what a user would type.
pub fn launch_in_terminal(
    program: &Path,
    cwd: &Path,
    args: &[&str],
    terminal: &str,
    tool: &str,
    command: &str,
) -> AppResult<()> {
    let repo = cwd;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        let _ = terminal;
        let _ = command;
        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd.current_dir(repo).creation_flags(CREATE_NEW_CONSOLE);
        let mut child = cmd.spawn().map_err(|e| {
            AppError::new(
                ErrorKind::LaunchFailed,
                format!("{tool} couldn't be started."),
            )
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
                format!("No terminal emulator was found to open {tool}. Set one in Settings → Coding assistant, or copy the prompt and run `{command}` yourself."),
            )
        })?;
        let mut cmd = Command::new(&term);
        let _ = tool;
        cmd.args(flag).arg(program).args(args);
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
