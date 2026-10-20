//! Finds the git executable on Windows and Linux.

use std::path::{Path, PathBuf};

/// Resolution order: explicit setting → PATH → well-known install locations.
pub fn locate_git(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configured.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return path.is_file().then_some(path);
    }
    if let Ok(p) = which::which("git") {
        return Some(p);
    }
    candidates().into_iter().find(|p| p.is_file())
}

#[cfg(windows)]
fn candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(base) = std::env::var(var) {
            v.push(Path::new(&base).join("Git").join("cmd").join("git.exe"));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        v.push(
            Path::new(&local)
                .join("Programs")
                .join("Git")
                .join("cmd")
                .join("git.exe"),
        );
        // GitHub Desktop's bundled git
        let gh = Path::new(&local).join("GitHubDesktop");
        if let Ok(entries) = std::fs::read_dir(&gh) {
            for e in entries.flatten() {
                let p = e
                    .path()
                    .join("resources")
                    .join("app")
                    .join("git")
                    .join("cmd")
                    .join("git.exe");
                v.push(p);
            }
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        v.push(
            Path::new(&profile)
                .join("scoop")
                .join("apps")
                .join("git")
                .join("current")
                .join("cmd")
                .join("git.exe"),
        );
    }
    v
}

#[cfg(not(windows))]
fn candidates() -> Vec<PathBuf> {
    [
        "/usr/bin/git",
        "/usr/local/bin/git",
        "/bin/git",
        "/home/linuxbrew/.linuxbrew/bin/git",
        "/opt/homebrew/bin/git",
    ]
    .iter()
    .map(|p| Path::new(p).to_path_buf())
    .collect()
}
