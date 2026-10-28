//! Code editors and a plain terminal: finding the installed ones and opening a repository or a
//! file at a line in them. No shell is ever involved; paths are separate argv entries.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

/// How an editor is told to jump to a line.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Goto {
    /// `--goto file:line` (VS Code and its forks).
    Flag,
    /// `file:line` (Zed, Sublime Text).
    Suffix,
    /// `--line N file` (JetBrains IDEs, Kate).
    LineFlag,
    /// `+N file` (gedit).
    Plus,
}

struct Known {
    id: &'static str,
    name: &'static str,
    bins: &'static [&'static str],
    goto: Goto,
    /// Opening a file also opens the repository folder (keeps the workspace).
    with_folder: bool,
    /// Windows install locations under %LOCALAPPDATA% / %ProgramFiles%.
    windows: &'static [&'static str],
}

const KNOWN: &[Known] = &[
    Known {
        id: "vscode",
        name: "Visual Studio Code",
        bins: &["code"],
        goto: Goto::Flag,
        with_folder: true,
        windows: &[
            "Programs/Microsoft VS Code/Code.exe",
            "Microsoft VS Code/Code.exe",
        ],
    },
    Known {
        id: "vscodium",
        name: "VSCodium",
        bins: &["codium", "vscodium"],
        goto: Goto::Flag,
        with_folder: true,
        windows: &["Programs/VSCodium/VSCodium.exe", "VSCodium/VSCodium.exe"],
    },
    Known {
        id: "cursor",
        name: "Cursor",
        bins: &["cursor"],
        goto: Goto::Flag,
        with_folder: true,
        windows: &["Programs/cursor/Cursor.exe"],
    },
    Known {
        id: "zed",
        name: "Zed",
        bins: &["zed", "zeditor", "zedit"],
        goto: Goto::Suffix,
        with_folder: true,
        windows: &["Programs/Zed/zed.exe"],
    },
    Known {
        id: "sublime",
        name: "Sublime Text",
        bins: &["subl", "sublime_text"],
        goto: Goto::Suffix,
        with_folder: false,
        windows: &["Sublime Text/subl.exe", "Sublime Text 3/subl.exe"],
    },
    Known {
        id: "idea",
        name: "IntelliJ IDEA",
        bins: &[
            "idea",
            "idea.sh",
            "intellij-idea-ultimate",
            "intellij-idea-community",
        ],
        goto: Goto::LineFlag,
        with_folder: false,
        windows: &[],
    },
    Known {
        id: "pycharm",
        name: "PyCharm",
        bins: &[
            "pycharm",
            "pycharm.sh",
            "pycharm-professional",
            "pycharm-community",
        ],
        goto: Goto::LineFlag,
        with_folder: false,
        windows: &[],
    },
    Known {
        id: "webstorm",
        name: "WebStorm",
        bins: &["webstorm", "webstorm.sh"],
        goto: Goto::LineFlag,
        with_folder: false,
        windows: &[],
    },
    Known {
        id: "rustrover",
        name: "RustRover",
        bins: &["rustrover", "rustrover.sh"],
        goto: Goto::LineFlag,
        with_folder: false,
        windows: &[],
    },
    Known {
        id: "kate",
        name: "Kate",
        bins: &["kate"],
        goto: Goto::LineFlag,
        with_folder: false,
        windows: &["Kate/bin/kate.exe"],
    },
    Known {
        id: "gedit",
        name: "gedit",
        bins: &["gedit", "gnome-text-editor"],
        goto: Goto::Plus,
        with_folder: false,
        windows: &[],
    },
];

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditorInfo {
    /// "vscode", "zed", … or "custom" for the path set in Settings.
    pub id: String,
    pub name: String,
    pub path: String,
}

fn windows_candidates(rel: &[&str]) -> Vec<PathBuf> {
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .flat_map(|base| rel.iter().map(move |r| PathBuf::from(&base).join(r)))
        .collect()
}

fn find(k: &Known) -> Option<PathBuf> {
    k.bins
        .iter()
        .find_map(|b| which::which(b).ok())
        .or_else(|| {
            cfg!(windows)
                .then(|| {
                    windows_candidates(k.windows)
                        .into_iter()
                        .find(|p| p.is_file())
                })
                .flatten()
        })
}

/// Editors installed on this machine (plus the custom one from Settings, if it exists).
pub fn detect(custom_path: &str) -> Vec<EditorInfo> {
    let mut out: Vec<EditorInfo> = KNOWN
        .iter()
        .filter_map(|k| {
            find(k).map(|p| EditorInfo {
                id: k.id.into(),
                name: k.name.into(),
                path: p.display().to_string(),
            })
        })
        .collect();
    let c = custom_path.trim();
    if !c.is_empty() && Path::new(c).is_file() {
        out.insert(
            0,
            EditorInfo {
                id: "custom".into(),
                name: Path::new(c)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Custom editor".into()),
                path: c.into(),
            },
        );
    }
    out
}

/// Arguments that open `file` (absolute) at `line` in the repository `root`.
fn args_for(
    goto: Option<Goto>,
    with_folder: bool,
    root: &Path,
    file: Option<(&Path, Option<u32>)>,
) -> Vec<String> {
    let root_s = root.display().to_string();
    let Some((file, line)) = file else {
        return vec![root_s];
    };
    let f = file.display().to_string();
    let mut args = Vec::new();
    if with_folder {
        args.push(root_s);
    }
    match (goto, line) {
        (Some(Goto::Flag), Some(l)) => args.extend(["--goto".into(), format!("{f}:{l}")]),
        (Some(Goto::Suffix), Some(l)) => args.push(format!("{f}:{l}")),
        (Some(Goto::LineFlag), Some(l)) => args.extend(["--line".into(), l.to_string(), f]),
        (Some(Goto::Plus), Some(l)) => args.extend([format!("+{l}"), f]),
        _ => args.push(f),
    }
    args
}

/// Opens the repository, or one of its files (relative, already validated) at a line.
pub fn open(
    choice: &str,
    custom_path: &str,
    root: &Path,
    file: Option<(&str, Option<u32>)>,
) -> AppResult<()> {
    let (program, known) = if choice == "custom" {
        let c = custom_path.trim();
        if c.is_empty() || !Path::new(c).is_file() {
            return Err(AppError::new(
                ErrorKind::LaunchFailed,
                "The editor set in Settings → Git → External tools doesn't exist. Fix the path or pick another editor.",
            ));
        }
        (PathBuf::from(c), None)
    } else {
        let pick = KNOWN
            .iter()
            .filter(|k| choice.is_empty() || k.id == choice)
            .find_map(|k| find(k).map(|p| (p, k)));
        let (p, k) = pick.ok_or_else(|| {
            AppError::new(
                ErrorKind::LaunchFailed,
                if choice.is_empty() {
                    "No code editor was found. Install one (for example Visual Studio Code) or set its path in Settings → Git → External tools."
                } else {
                    "The editor chosen in Settings → Git → External tools isn't installed any more. Pick another one."
                },
            )
        })?;
        (p, Some(k))
    };
    let abs = file.map(|(rel, line)| (root.join(rel), line));
    let args = args_for(
        known.map(|k| k.goto),
        known.is_some_and(|k| k.with_folder),
        root,
        abs.as_ref().map(|(p, l)| (p.as_path(), *l)),
    );
    spawn(&program, &args, root, "The editor couldn't be started.")
}

/// Opens a terminal window in `root`: Windows Terminal or a new console on Windows, the
/// configured or first available emulator elsewhere.
pub fn open_terminal(root: &Path, terminal: &str) -> AppResult<()> {
    #[cfg(windows)]
    {
        let _ = terminal;
        if let Ok(wt) = which::which("wt") {
            let dir = root.display().to_string();
            return spawn(
                &wt,
                &["-d".to_string(), dir],
                root,
                "Windows Terminal couldn't be started.",
            );
        }
        let cmd = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .unwrap_or_else(|| "cmd.exe".into());
        spawn_console(&cmd, root)
    }
    #[cfg(not(windows))]
    {
        let (term, _) = crate::cli::find_terminal(terminal).ok_or_else(|| {
            AppError::new(
                ErrorKind::LaunchFailed,
                "No terminal emulator was found. Set one in Settings → Coding assistant.",
            )
        })?;
        spawn(&term, &[], root, "The terminal couldn't be started.")
    }
}

#[cfg(windows)]
fn spawn_console(program: &Path, cwd: &Path) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let mut child = Command::new(program)
        .current_dir(cwd)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| {
            AppError::new(ErrorKind::LaunchFailed, "The terminal couldn't be started.")
                .with_detail(e.to_string())
        })?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn spawn(program: &Path, args: &[String], cwd: &Path, failed: &str) -> AppResult<()> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(ErrorKind::LaunchFailed, failed)
            .with_detail(format!("{}: {e}", program.display()))
    })?;
    // Reap the process when it exits so it doesn't linger as a zombie.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_arguments_per_editor() {
        let root = Path::new("/r");
        let f = Path::new("/r/src/a b.rs");
        assert_eq!(
            args_for(Some(Goto::Flag), true, root, Some((f, Some(7)))),
            ["/r", "--goto", "/r/src/a b.rs:7"]
        );
        assert_eq!(
            args_for(Some(Goto::Suffix), false, root, Some((f, Some(7)))),
            ["/r/src/a b.rs:7"]
        );
        assert_eq!(
            args_for(Some(Goto::LineFlag), false, root, Some((f, Some(7)))),
            ["--line", "7", "/r/src/a b.rs"]
        );
        assert_eq!(
            args_for(Some(Goto::Plus), false, root, Some((f, Some(7)))),
            ["+7", "/r/src/a b.rs"]
        );
        assert_eq!(
            args_for(Some(Goto::Flag), true, root, Some((f, None))),
            ["/r", "/r/src/a b.rs"]
        );
        // A custom editor gets the file only: its line syntax isn't known.
        assert_eq!(
            args_for(None, false, root, Some((f, Some(7)))),
            ["/r/src/a b.rs"]
        );
        assert_eq!(args_for(None, false, root, None), ["/r"]);
    }

    #[test]
    fn custom_editor_must_exist() {
        let e = open("custom", "/definitely/not/here", Path::new("/"), None).unwrap_err();
        assert_eq!(e.kind, ErrorKind::LaunchFailed);
        assert!(detect("/definitely/not/here")
            .iter()
            .all(|e| e.id != "custom"));
    }
}
