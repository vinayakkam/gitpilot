//! Worktrees: more than one branch checked out at once, each in its own folder.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use super::repo::Repo;
use super::runner::RunOpts;
use super::validate as v;
use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Worktree {
    pub path: String,
    /// Commit checked out (none in a bare main repository).
    pub head: Option<String>,
    /// Branch checked out (short name); `None` when detached.
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    /// The main working tree (the first one); it can't be removed.
    pub main: bool,
    /// The worktree GitPilot has open.
    pub current: bool,
    pub locked: bool,
    /// The folder is gone; `git worktree prune` cleans it up.
    pub prunable: bool,
}

/// Parses `git worktree list --porcelain`: blocks separated by blank lines.
pub fn parse_list(raw: &str) -> Vec<Worktree> {
    let mut out: Vec<Worktree> = Vec::new();
    for block in raw.split("\n\n").filter(|b| !b.trim().is_empty()) {
        let mut w = Worktree {
            path: String::new(),
            head: None,
            branch: None,
            detached: false,
            bare: false,
            main: out.is_empty(),
            current: false,
            locked: false,
            prunable: false,
        };
        for line in block.lines() {
            let (key, value) = line.split_once(' ').unwrap_or((line, ""));
            match key {
                "worktree" => w.path = value.to_string(),
                "HEAD" => w.head = Some(value.to_string()),
                "branch" => {
                    w.branch = Some(
                        value
                            .strip_prefix("refs/heads/")
                            .unwrap_or(value)
                            .to_string(),
                    )
                }
                "detached" => w.detached = true,
                "bare" => w.bare = true,
                "locked" => w.locked = true,
                "prunable" => w.prunable = true,
                _ => {}
            }
        }
        if !w.path.is_empty() {
            out.push(w);
        }
    }
    out
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// A new worktree's folder: absolute, and either missing or empty.
pub fn check_new_path(path: &str) -> AppResult<PathBuf> {
    let p = PathBuf::from(path.trim());
    if path.trim().is_empty() || !p.is_absolute() {
        return Err(AppError::invalid("Choose a folder for the worktree."));
    }
    if p.exists() {
        let empty = p
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if !p.is_dir() || !empty {
            return Err(AppError::new(
                ErrorKind::AlreadyExists,
                "That folder already exists and isn't empty. Choose another name or location.",
            ));
        }
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(AppError::new(
            ErrorKind::PathNotFound,
            "The folder it would go in doesn't exist.",
        ));
    }
    Ok(p)
}

impl Repo<'_> {
    pub async fn worktrees(&self) -> AppResult<Vec<Worktree>> {
        let raw = self
            .git
            .read(self.path, ["worktree", "list", "--porcelain"])
            .await?;
        let mut list = parse_list(&raw);
        for w in &mut list {
            w.current = same_dir(Path::new(&w.path), self.path);
        }
        Ok(list)
    }

    /// Checks out `branch` in a new folder. With `new_branch`, creates it from `start`
    /// (default: the current commit). Returns the folder.
    pub async fn worktree_add(
        &self,
        path: &str,
        branch: &str,
        new_branch: bool,
        start: Option<&str>,
    ) -> AppResult<String> {
        let dest = check_new_path(path)?;
        let branch = v::ref_name(branch)?;
        let dest_s = dest.display().to_string();
        let mut args: Vec<&str> = vec!["worktree", "add"];
        if new_branch {
            args.extend(["-b", branch, "--", &dest_s]);
            if let Some(s) = start {
                args.push(v::revision(s)?);
            }
        } else {
            args.extend(["--", &dest_s, branch]);
        }
        self.git.run(self.path, &args, RunOpts::default()).await?;
        Ok(dest_s)
    }

    /// Removes a linked worktree's folder. Git refuses when it has uncommitted changes or is
    /// locked; there is no force option.
    pub async fn worktree_remove(&self, path: &str) -> AppResult<()> {
        let list = self.worktrees().await?;
        let w = list
            .iter()
            .find(|w| same_dir(Path::new(&w.path), Path::new(path)))
            .ok_or_else(|| {
                AppError::invalid("That worktree wasn't found. Refresh and try again.")
            })?;
        if w.main {
            return Err(AppError::invalid("The main working tree can't be removed."));
        }
        if w.current {
            return Err(AppError::invalid(
                "This worktree is the one open in GitPilot. Open another one first.",
            ));
        }
        let p = w.path.clone();
        self.git
            .run(
                self.path,
                ["worktree", "remove", "--", &p],
                RunOpts::default(),
            )
            .await?;
        Ok(())
    }

    /// Forgets worktrees whose folders were deleted.
    pub async fn worktree_prune(&self) -> AppResult<()> {
        self.git
            .run(self.path, ["worktree", "prune"], RunOpts::default())
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_worktree_list() {
        let raw = "worktree /work/app\nHEAD 1111\nbranch refs/heads/main\n\n\
worktree /work/app-fix\nHEAD 2222\nbranch refs/heads/fix/login\nlocked reason here\n\n\
worktree /work/app-old\nHEAD 3333\ndetached\nprunable gitdir file points to non-existent location\n\n";
        let w = parse_list(raw);
        assert_eq!(w.len(), 3);
        assert!(w[0].main && !w[1].main);
        assert_eq!(w[1].branch.as_deref(), Some("fix/login"));
        assert!(w[1].locked);
        assert!(w[2].detached && w[2].prunable && w[2].branch.is_none());
        assert_eq!(w[2].head.as_deref(), Some("3333"));
    }

    #[test]
    fn checks_new_paths() {
        let dir = tempfile::tempdir().unwrap();
        assert!(check_new_path("relative/dir").is_err());
        assert!(check_new_path(dir.path().join("new").to_str().unwrap()).is_ok());
        assert!(
            check_new_path(dir.path().to_str().unwrap()).is_ok(),
            "empty folder is fine"
        );
        std::fs::write(dir.path().join("f"), "x").unwrap();
        assert!(check_new_path(dir.path().to_str().unwrap()).is_err());
        assert!(check_new_path(dir.path().join("a/b").to_str().unwrap()).is_err());
    }
}
