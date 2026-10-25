//! Git LFS: whether it's installed, which file types a repository stores with it, which LFS
//! files are downloaded, and tracking or untracking file types. Detection works without LFS
//! installed (it reads `.gitattributes`), so GitPilot can warn when a repository needs it.

use serde::Serialize;
use ts_rs::TS;

use super::repo::Repo;
use super::runner::{Git, RunOpts};
use crate::error::{AppError, AppResult, ErrorKind};

/// LFS files listed at most.
const MAX_FILES: usize = 500;

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsPattern {
    pub pattern: String,
    /// The `.gitattributes` file it's in, relative to the repository root.
    pub file: String,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsFile {
    pub path: String,
    /// The real content is on disk (false: only the small pointer file is).
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LfsStatus {
    /// `git lfs` works on this computer.
    pub installed: bool,
    pub version: Option<String>,
    /// File types stored with LFS (empty: the repository doesn't use LFS).
    pub patterns: Vec<LfsPattern>,
    /// LFS files (up to 500), only known when LFS is installed.
    pub files: Vec<LfsFile>,
    pub file_count: u32,
    /// LFS's Git hooks are set up in this repository (needed to push LFS files).
    pub hooks_installed: bool,
}

/// Splits a `.gitattributes` line into its pattern (C-style quoted or not) and attributes.
fn split_line(line: &str) -> Option<(String, &str)> {
    let Some(rest) = line.strip_prefix('"') else {
        let (p, attrs) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        return Some((p.to_string(), attrs));
    };
    let mut out = String::new();
    let mut chars = rest.char_indices();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => out.push(chars.next()?.1),
            '"' => return Some((out, &rest[i + 1..])),
            _ => out.push(c),
        }
    }
    None
}

/// Patterns with `filter=lfs` in one `.gitattributes` file.
pub fn lfs_patterns(attributes: &str) -> Vec<String> {
    attributes
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let (pattern, attrs) = split_line(l)?;
            attrs
                .split_whitespace()
                .any(|a| a == "filter=lfs")
                .then_some(pattern)
        })
        .collect()
}

/// Parses `git lfs ls-files` ("<oid> * <path>" downloaded, "<oid> - <path>" pointer only).
pub fn parse_ls_files(raw: &str) -> Vec<LfsFile> {
    raw.lines()
        .filter_map(|l| {
            let (_, rest) = l.split_once(' ')?;
            let (mark, path) = rest.split_once(' ')?;
            match mark {
                "*" => Some(true),
                "-" => Some(false),
                _ => None,
            }
            .map(|downloaded| LfsFile {
                path: path.to_string(),
                downloaded,
            })
        })
        .collect()
}

/// `git lfs version`, or `None` when LFS isn't installed.
pub async fn version(git: &Git, cwd: &std::path::Path) -> Option<String> {
    let out = git
        .run(
            cwd,
            ["lfs", "version"],
            RunOpts {
                ok_codes: &[1],
                read_only: true,
                ..RunOpts::default()
            },
        )
        .await
        .ok()?;
    let text = out.text();
    (out.code == 0 && text.starts_with("git-lfs/")).then(|| text.trim().to_string())
}

/// A file type pattern for `git lfs track`: one line, not an option, not a comment or negation.
pub fn check_pattern(pattern: &str) -> AppResult<&str> {
    let p = pattern.trim();
    if p.is_empty() {
        return Err(AppError::invalid("Enter a file pattern, like *.psd."));
    }
    if p.starts_with(['-', '#', '!']) || p.chars().any(|c| c.is_control()) {
        return Err(AppError::invalid(
            "A pattern can't start with -, # or ! and must be on one line.",
        ));
    }
    Ok(p)
}

fn needs_lfs() -> AppError {
    AppError::new(
        ErrorKind::Git,
        "Git LFS isn't installed. Install it from git-lfs.com, then try again.",
    )
}

impl Repo<'_> {
    async fn lfs_read(&self, args: &[&str]) -> AppResult<String> {
        self.git.read(self.path, args).await
    }

    /// `with_files`: also list LFS files and check hooks (slower in big repositories).
    pub async fn lfs_status(&self, with_files: bool) -> AppResult<LfsStatus> {
        let version = version(self.git, self.path).await;
        let installed = version.is_some();

        // The root .gitattributes (even if not committed yet) and any committed nested ones.
        let listed = self.lfs_read(&["ls-files", "-z"]).await?;
        let mut files: Vec<String> = listed
            .split('\0')
            .filter(|p| *p == ".gitattributes" || p.ends_with("/.gitattributes"))
            .map(String::from)
            .collect();
        if !files.iter().any(|f| f == ".gitattributes") {
            files.insert(0, ".gitattributes".into());
        }
        let mut patterns = Vec::new();
        for f in files {
            let Ok(text) = std::fs::read_to_string(self.path.join(&f)) else {
                continue;
            };
            patterns.extend(lfs_patterns(&text).into_iter().map(|pattern| LfsPattern {
                pattern,
                file: f.clone(),
            }));
        }

        let (mut lfs_files, mut hooks_installed) = (Vec::new(), false);
        if with_files && installed && !patterns.is_empty() {
            lfs_files = parse_ls_files(&self.lfs_read(&["lfs", "ls-files"]).await?);
            let hook = self
                .lfs_read(&["rev-parse", "--git-path", "hooks/pre-push"])
                .await?;
            let hook = self.path.join(hook.trim());
            hooks_installed = std::fs::read_to_string(hook)
                .map(|h| h.contains("git lfs") || h.contains("git-lfs"))
                .unwrap_or(false);
        }
        let file_count = lfs_files.len() as u32;
        lfs_files.truncate(MAX_FILES);
        Ok(LfsStatus {
            installed,
            version,
            patterns,
            files: lfs_files,
            file_count,
            hooks_installed,
        })
    }

    /// Stores files matching `pattern` with LFS from now on (adds it to .gitattributes).
    pub async fn lfs_track(&self, pattern: &str) -> AppResult<()> {
        let p = check_pattern(pattern)?;
        if version(self.git, self.path).await.is_none() {
            return Err(needs_lfs());
        }
        self.git
            .run(self.path, ["lfs", "track", "--", p], RunOpts::default())
            .await?;
        Ok(())
    }

    /// Stops storing `pattern` with LFS (files already committed stay as they are).
    pub async fn lfs_untrack(&self, pattern: &str) -> AppResult<()> {
        let p = check_pattern(pattern)?;
        if version(self.git, self.path).await.is_none() {
            return Err(needs_lfs());
        }
        self.git
            .run(self.path, ["lfs", "untrack", "--", p], RunOpts::default())
            .await?;
        Ok(())
    }

    /// Sets up LFS's hooks in this repository only (`git lfs install --local`).
    pub async fn lfs_install_hooks(&self) -> AppResult<()> {
        if version(self.git, self.path).await.is_none() {
            return Err(needs_lfs());
        }
        self.git
            .run(self.path, ["lfs", "install", "--local"], RunOpts::default())
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_lfs_patterns() {
        let attrs = "# assets\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.png binary\n\
                     \"big file.bin\" filter=lfs\n  \nvideo/** filter=lfs diff=lfs merge=lfs -text\n";
        assert_eq!(
            lfs_patterns(attrs),
            vec!["*.psd", "big file.bin", "video/**"]
        );
        assert!(lfs_patterns("\"unterminated filter=lfs\n").is_empty());
        assert!(lfs_patterns("* text=auto\n").is_empty());
    }

    #[test]
    fn parses_ls_files() {
        let f = parse_ls_files(
            "4d7a214614 * art/logo.psd\n0123456789 - videos/intro file.mp4\nnoise\n",
        );
        assert_eq!(
            f,
            vec![
                LfsFile {
                    path: "art/logo.psd".into(),
                    downloaded: true
                },
                LfsFile {
                    path: "videos/intro file.mp4".into(),
                    downloaded: false
                },
            ]
        );
    }

    #[test]
    fn checks_patterns() {
        assert_eq!(check_pattern(" *.psd ").unwrap(), "*.psd");
        assert!(check_pattern("").is_err());
        assert!(check_pattern("--help").is_err());
        assert!(check_pattern("#x").is_err());
        assert!(check_pattern("!x").is_err());
        assert!(check_pattern("a\nb").is_err());
    }
}
