//! High-level repository operations built on the runner and parsers.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::diff::{self, FileDiff};
use super::log::{self, CommitDetail, LogPage, LogQuery};
use super::refs::{self, Branch, Remote, Stash};
use super::runner::{Git, RunOpts, NETWORK_TIMEOUT};
use super::status::{self, Area, BranchInfo, FileEntry};
use super::validate as v;
use crate::error::{AppError, AppResult, ErrorKind};
use tokio::sync::Notify;

/// Applied to every network-capable command: never allow command-executing transports.
const NO_EXT: [&str; 4] = [
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "protocol.fd.allow=never",
];
const DIFF_FLAGS: [&str; 7] = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "-M",
    "--no-relative",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RepoState {
    Normal,
    Merging,
    Rebasing,
    CherryPicking,
    Reverting,
    Bisecting,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoStatus {
    pub branch: BranchInfo,
    pub files: Vec<FileEntry>,
    pub state: RepoState,
    /// Unix time of the last fetch (FETCH_HEAD mtime); `None` if never fetched.
    #[ts(type = "number | null")]
    pub last_fetch: Option<i64>,
    pub stash_count: u32,
    /// When the branch has no upstream but a remote branch with the same name exists
    /// (e.g. `origin/main`), how the two compare. Lets the UI offer Pull and linking.
    pub remote_twin: Option<RemoteTwin>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteTwin {
    /// Short name, e.g. "origin/main".
    pub name: String,
    pub remote: String,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    /// The two branches share no commits at all.
    pub unrelated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PullStrategy {
    FfOnly,
    Merge,
    Rebase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SequenceAction {
    Continue,
    Skip,
    Abort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PullOptions {
    /// Overrides the saved pull strategy for this pull only.
    pub strategy: Option<PullStrategy>,
    /// Allow combining branches that share no history (`--allow-unrelated-histories`).
    pub allow_unrelated: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchComparison {
    pub base: String,
    pub head: String,
    /// Commits on `head` that are not on `base`.
    pub ahead: Vec<log::CommitSummary>,
    /// Commits on `base` that are not on `head`.
    pub behind: Vec<log::CommitSummary>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiscardResult {
    /// Where copies of discarded tracked files were saved, if any.
    pub backup_dir: Option<String>,
    pub trashed: u32,
}

pub struct Repo<'a> {
    pub git: &'a Git,
    pub path: &'a Path,
}

/// Returns the work-tree root if `dir` is inside a non-bare git repository.
pub async fn discover(git: &Git, dir: &Path) -> AppResult<PathBuf> {
    if !dir.is_dir() {
        return Err(AppError::new(
            ErrorKind::PathNotFound,
            "That folder doesn't exist.",
        ));
    }
    let out = git
        .run(
            dir,
            ["rev-parse", "--is-bare-repository", "--show-toplevel"],
            RunOpts::read(),
        )
        .await?;
    let text = out.text();
    let mut lines = text.lines();
    if lines.next() == Some("true") {
        return Err(AppError::new(
            ErrorKind::NotARepository,
            "This is a bare repository (no working files). GitPilot works with regular repositories.",
        ));
    }
    let top = lines
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::NotARepository,
                "This folder is not a Git repository.",
            )
        })?;
    Ok(PathBuf::from(top))
}

pub async fn init(git: &Git, dir: &Path, default_branch: Option<&str>) -> AppResult<()> {
    if !dir.is_dir() {
        return Err(AppError::new(
            ErrorKind::PathNotFound,
            "That folder doesn't exist.",
        ));
    }
    let mut args = vec!["init".to_string()];
    if let Some(b) = default_branch.map(str::trim).filter(|b| !b.is_empty()) {
        args.push(format!("--initial-branch={}", v::ref_name(b)?));
    }
    git.run(dir, &args, RunOpts::default()).await?;
    Ok(())
}

pub async fn clone<F: FnMut(String) + Send>(
    git: &Git,
    url: &str,
    dest: &Path,
    cancel: Option<&Notify>,
    on_progress: F,
) -> AppResult<PathBuf> {
    let url = v::remote_url(url)?;
    if dest.exists() {
        let empty = dest
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(AppError::new(
                ErrorKind::AlreadyExists,
                "The destination folder already exists and isn't empty. Choose another name or location.",
            ));
        }
    }
    let parent = dest.parent().filter(|p| p.is_dir()).ok_or_else(|| {
        AppError::new(
            ErrorKind::PathNotFound,
            "The destination's parent folder doesn't exist.",
        )
    })?;
    let mut args: Vec<std::ffi::OsString> = NO_EXT.iter().map(Into::into).collect();
    args.extend([
        "clone".into(),
        "--progress".into(),
        "--".into(),
        url.into(),
        dest.as_os_str().to_owned(),
    ]);
    let existed = dest.exists();
    let res = git
        .run_streaming(parent, args, NETWORK_TIMEOUT, cancel, on_progress)
        .await;
    if let Err(e) = res {
        // A failed or cancelled clone leaves a partial folder behind. It was absent or empty
        // before we started (checked above), so removing what git created loses nothing.
        if dest.exists() {
            if existed {
                if let Ok(entries) = std::fs::read_dir(dest) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        let _ = if p.is_dir() {
                            std::fs::remove_dir_all(&p)
                        } else {
                            std::fs::remove_file(&p)
                        };
                    }
                }
            } else {
                let _ = std::fs::remove_dir_all(dest);
            }
        }
        return Err(e);
    }
    Ok(dest.to_path_buf())
}

fn mtime_secs(p: &Path) -> Option<i64> {
    let m = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(m.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64)
}

impl Repo<'_> {
    async fn read<I, S>(&self, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        self.git.read(self.path, args).await
    }

    async fn write<I, S>(&self, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        Ok(self
            .git
            .run(self.path, args, RunOpts::default())
            .await?
            .text())
    }

    async fn dirs(&self) -> AppResult<(PathBuf, PathBuf)> {
        let out = self
            .read(["rev-parse", "--absolute-git-dir", "--git-common-dir"])
            .await?;
        let mut l = out.lines();
        let git_dir = PathBuf::from(l.next().unwrap_or_default());
        let common = l
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| git_dir.clone());
        let common = if common.is_absolute() {
            common
        } else {
            self.path.join(common)
        };
        Ok((git_dir, common))
    }

    async fn is_unborn(&self) -> bool {
        self.git
            .run(
                self.path,
                ["rev-parse", "--verify", "--quiet", "HEAD"],
                RunOpts::read(),
            )
            .await
            .is_err()
    }

    // ---------- status & diffs ----------

    pub async fn status(&self) -> AppResult<RepoStatus> {
        let out = self
            .git
            .run(
                self.path,
                [
                    "status",
                    "--porcelain=v2",
                    "--branch",
                    "-z",
                    "--untracked-files=all",
                    "--find-renames",
                ],
                RunOpts::read(),
            )
            .await?;
        let mut parsed = status::parse(&out.stdout);
        let ignored = self.tracked_ignored().await;
        if !ignored.is_empty() {
            for f in &mut parsed.files {
                f.ignored = f.area != Area::Untracked && ignored.contains(&f.path);
            }
        }
        let (git_dir, common) = self.dirs().await?;
        let state =
            if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
                RepoState::Rebasing
            } else if git_dir.join("MERGE_HEAD").exists() {
                RepoState::Merging
            } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
                RepoState::CherryPicking
            } else if git_dir.join("REVERT_HEAD").exists() {
                RepoState::Reverting
            } else if git_dir.join("BISECT_LOG").exists() {
                RepoState::Bisecting
            } else {
                RepoState::Normal
            };
        let stash_count = self.stash_list().await.map(|s| s.len() as u32).unwrap_or(0);
        let remote_twin = match (
            &parsed.branch.head,
            &parsed.branch.upstream,
            parsed.branch.unborn,
        ) {
            (Some(head), None, _) => self.remote_twin(head, parsed.branch.unborn).await,
            _ => None,
        };
        Ok(RepoStatus {
            branch: parsed.branch,
            files: parsed.files,
            state,
            last_fetch: mtime_secs(&common.join("FETCH_HEAD")),
            stash_count,
            remote_twin,
        })
    }

    /// Tracked files that .gitignore says should be ignored.
    async fn tracked_ignored(&self) -> std::collections::HashSet<String> {
        let Ok(out) = self
            .git
            .run(
                self.path,
                [
                    "ls-files",
                    "-z",
                    "--cached",
                    "--ignored",
                    "--exclude-standard",
                ],
                RunOpts::read(),
            )
            .await
        else {
            return Default::default();
        };
        out.stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect()
    }

    /// Adds patterns to the repository's top-level .gitignore (skipping ones already there).
    /// Returns the patterns that were added.
    pub async fn ignore_add(&self, patterns: &[String]) -> AppResult<Vec<String>> {
        let mut clean = Vec::new();
        for p in patterns {
            let p = p.trim();
            if p.is_empty() {
                continue;
            }
            if p.len() > 400 || p.contains(['\n', '\r', '\0']) {
                return Err(AppError::invalid(
                    "An ignore pattern must be a single line.",
                ));
            }
            if !clean.iter().any(|c: &String| c == p) {
                clean.push(p.to_string());
            }
        }
        if clean.is_empty() {
            return Err(AppError::invalid("Enter a pattern to ignore."));
        }
        let file = self.path.join(".gitignore");
        let existing = std::fs::read_to_string(&file).unwrap_or_default();
        let have: std::collections::HashSet<&str> = existing.lines().map(str::trim).collect();
        let added: Vec<String> = clean
            .into_iter()
            .filter(|p| !have.contains(p.as_str()))
            .collect();
        if added.is_empty() {
            return Ok(added);
        }
        let mut content = existing.clone();
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        for p in &added {
            content.push_str(p);
            content.push('\n');
        }
        std::fs::write(&file, content)?;
        Ok(added)
    }

    /// Stops tracking files (or folders) without deleting them from disk: `git rm --cached`.
    /// The removal is staged; committing it removes the files from the repository.
    pub async fn untrack(&self, paths: &[String]) -> AppResult<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let paths = v::rel_paths(paths)?;
        let mut args = vec!["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--"];
        args.extend(paths);
        self.write(args).await?;
        Ok(())
    }

    /// Finds `<remote>/<branch>` for a branch without upstream, preferring "origin".
    async fn remote_twin(&self, branch: &str, unborn: bool) -> Option<RemoteTwin> {
        let remotes: Vec<String> = self
            .read(["remote"])
            .await
            .ok()?
            .lines()
            .map(String::from)
            .collect();
        let mut ordered: Vec<&String> = remotes.iter().filter(|r| r.as_str() == "origin").collect();
        ordered.extend(remotes.iter().filter(|r| r.as_str() != "origin"));
        for remote in ordered {
            let full = format!("refs/remotes/{remote}/{branch}");
            if self
                .git
                .run(
                    self.path,
                    ["rev-parse", "--verify", "--quiet", &full],
                    RunOpts::read(),
                )
                .await
                .is_err()
            {
                continue;
            }
            let name = format!("{remote}/{branch}");
            if unborn {
                let behind = self
                    .read(["rev-list", "--count", &full])
                    .await
                    .ok()
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0);
                return Some(RemoteTwin {
                    name,
                    remote: remote.clone(),
                    branch: branch.into(),
                    ahead: 0,
                    behind,
                    unrelated: false,
                });
            }
            let counts = self
                .read([
                    "rev-list",
                    "--left-right",
                    "--count",
                    &format!("HEAD...{full}"),
                ])
                .await
                .ok()?;
            let mut it = counts
                .split_whitespace()
                .map(|n| n.parse::<u32>().unwrap_or(0));
            let (ahead, behind) = (it.next().unwrap_or(0), it.next().unwrap_or(0));
            let unrelated = self
                .git
                .run(
                    self.path,
                    ["merge-base", "HEAD", &full],
                    RunOpts {
                        ok_codes: &[1],
                        read_only: true,
                        ..RunOpts::default()
                    },
                )
                .await
                .map(|o| o.code == 1)
                .unwrap_or(false);
            return Some(RemoteTwin {
                name,
                remote: remote.clone(),
                branch: branch.into(),
                ahead,
                behind,
                unrelated,
            });
        }
        None
    }

    /// Diff for one file in the working tree / index. Read-only.
    pub async fn file_diff(
        &self,
        path: &str,
        area: Area,
        orig_path: Option<&str>,
    ) -> AppResult<FileDiff> {
        let path = v::rel_path(path)?;
        match area {
            Area::Untracked => {
                let full = self.path.join(path);
                let meta = std::fs::symlink_metadata(&full)?;
                if meta.is_dir() {
                    // Untracked nested repository or similar.
                    return Ok(FileDiff {
                        new_path: Some(path.to_string()),
                        new_file: true,
                        binary: true,
                        ..FileDiff::default()
                    });
                }
                let len = meta.len() as usize;
                let bytes = if len > diff::MAX_DIFF_BYTES * 2 {
                    use std::io::Read;
                    let mut b = vec![0; diff::MAX_DIFF_BYTES + 1];
                    let n = std::fs::File::open(&full)?.read(&mut b)?;
                    b.truncate(n);
                    b
                } else {
                    std::fs::read(&full)?
                };
                Ok(diff::untracked_file_diff(path, &bytes))
            }
            Area::Conflicted => {
                let full = self.path.join(path);
                match std::fs::read(&full) {
                    Ok(bytes) => Ok(diff::conflict_file_view(path, &bytes)),
                    // Deleted-by-us/them conflicts may have no working file.
                    Err(_) => Ok(FileDiff {
                        old_path: Some(path.to_string()),
                        conflict_view: true,
                        deleted_file: true,
                        ..FileDiff::default()
                    }),
                }
            }
            Area::Staged | Area::Unstaged => {
                let raw = self.raw_diff(path, area == Area::Staged, orig_path).await?;
                let mut files = diff::parse(&raw);
                Ok(files.pop().unwrap_or_else(|| FileDiff {
                    new_path: Some(path.to_string()),
                    ..FileDiff::default()
                }))
            }
        }
    }

    async fn raw_diff(
        &self,
        path: &str,
        staged: bool,
        orig_path: Option<&str>,
    ) -> AppResult<Vec<u8>> {
        let mut args: Vec<String> = vec!["-c".into(), "diff.noprefix=false".into(), "diff".into()];
        if staged {
            args.push("--cached".into());
        }
        args.extend(DIFF_FLAGS.iter().map(|s| s.to_string()));
        args.push("--".into());
        args.push(path.into());
        if let Some(o) = orig_path {
            args.push(v::rel_path(o)?.into());
        }
        Ok(self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout)
    }

    // ---------- staging ----------

    pub async fn stage(&self, paths: &[String]) -> AppResult<()> {
        let paths = v::rel_paths(paths)?;
        let mut args = vec!["add", "-A", "--"];
        args.extend(paths);
        self.write(args).await?;
        Ok(())
    }

    pub async fn unstage(&self, paths: &[String]) -> AppResult<()> {
        let paths = v::rel_paths(paths)?;
        let mut args = if self.is_unborn().await {
            vec!["rm", "--cached", "-r", "-q", "--"]
        } else {
            vec!["restore", "--staged", "--"]
        };
        args.extend(paths);
        self.write(args).await?;
        Ok(())
    }

    pub async fn stage_all(&self) -> AppResult<()> {
        self.write(["add", "-A"]).await?;
        Ok(())
    }

    pub async fn unstage_all(&self) -> AppResult<()> {
        if self.is_unborn().await {
            self.write(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", "."])
                .await?;
        } else {
            self.write(["reset", "-q", "--"]).await?;
        }
        Ok(())
    }

    /// Stages (or, with `unstage`, unstages) a single hunk using `git apply --cached`.
    /// The patch is regenerated here, byte-exact, so the frontend only identifies the hunk.
    pub async fn apply_hunk(&self, path: &str, hunk_header: &str, unstage: bool) -> AppResult<()> {
        let path = v::rel_path(path)?;
        let raw = self.raw_diff(path, unstage, None).await?;
        let patch = diff::patch_for_hunk(&raw, hunk_header).ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidInput,
                "This change was modified since it was displayed. Refresh and try again.",
            )
        })?;
        let mut args = vec!["apply", "--cached", "--whitespace=nowarn"];
        if unstage {
            args.push("--reverse");
        }
        args.push("-");
        self.git
            .run(
                self.path,
                args,
                RunOpts {
                    stdin: Some(&patch),
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok(())
    }

    /// Discards unstaged changes to tracked files. A copy of each current file is saved
    /// to `backup_root/<timestamp>/` first so the change can be recovered.
    pub async fn discard_tracked(
        &self,
        paths: &[String],
        backup_root: &Path,
    ) -> AppResult<DiscardResult> {
        let paths = v::rel_paths(paths)?;
        let stamp = chrono_stamp();
        let dir = backup_root.join(&stamp);
        let mut backed_up = false;
        for p in &paths {
            let src = self.path.join(p);
            if src.is_file() {
                let dst = dir.join(p);
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(&src, &dst)?;
                backed_up = true;
            }
        }
        let mut args = vec!["restore", "--worktree", "--"];
        args.extend(paths);
        self.write(args).await?;
        Ok(DiscardResult {
            backup_dir: backed_up.then(|| dir.display().to_string()),
            trashed: 0,
        })
    }

    /// Moves untracked files (or directories) to the OS trash. Requires the files to be untracked.
    pub async fn discard_untracked(&self, paths: &[String]) -> AppResult<DiscardResult> {
        let paths = v::rel_paths(paths)?;
        // Confirm with git that every path is really untracked (never trash tracked work).
        let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
        args.extend(paths.iter().copied());
        let listed = self.read(args).await?;
        let untracked: std::collections::HashSet<&str> =
            listed.split('\0').filter(|s| !s.is_empty()).collect();
        let mut targets = Vec::new();
        for p in &paths {
            let full = self.path.join(p);
            let is_untracked_dir = full.is_dir()
                && untracked
                    .iter()
                    .any(|u| u.starts_with(&format!("{}/", p.trim_end_matches('/'))));
            if untracked.contains(p) || is_untracked_dir {
                targets.push(full);
            } else {
                return Err(AppError::invalid(format!(
                    "'{p}' is not an untracked file, so it was left alone."
                )));
            }
        }
        let n = targets.len() as u32;
        trash::delete_all(&targets).map_err(|e| {
            AppError::new(
                ErrorKind::PermissionDenied,
                "The files couldn't be moved to the trash.",
            )
            .with_detail(e.to_string())
        })?;
        Ok(DiscardResult {
            backup_dir: None,
            trashed: n,
        })
    }

    // ---------- commit ----------

    pub async fn commit(&self, message: &str) -> AppResult<String> {
        if message.trim().is_empty() {
            return Err(AppError::new(
                ErrorKind::EmptyMessage,
                "Write a commit message first.",
            ));
        }
        // Check staged changes explicitly so the error is precise (and we never auto-stage).
        let staged = self
            .git
            .run(
                self.path,
                ["diff", "--cached", "--quiet"],
                RunOpts {
                    ok_codes: &[1],
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await?;
        let (_, common) = self.dirs().await?;
        let merging = common.join("MERGE_HEAD").exists();
        if staged.code == 0 && !merging {
            return Err(AppError::new(
                ErrorKind::NothingToCommit,
                "There are no staged changes to commit.",
            ));
        }
        let msg = message.as_bytes();
        let res = self
            .git
            .run(
                self.path,
                ["commit", "--file=-"],
                RunOpts {
                    stdin: Some(msg),
                    ..RunOpts::default()
                },
            )
            .await;
        match res {
            Ok(_) => Ok(self.read(["rev-parse", "HEAD"]).await?.trim().to_string()),
            Err(mut e) => {
                // A hook that fails produces arbitrary output; if a hook exists, say so.
                if e.kind == ErrorKind::Git && self.has_hook("pre-commit").await
                    || e.kind == ErrorKind::Git && self.has_hook("commit-msg").await
                {
                    e.kind = ErrorKind::HookFailed;
                    e.message =
                        "A commit hook rejected this commit. See the details for its output."
                            .into();
                }
                Err(e)
            }
        }
    }

    async fn has_hook(&self, name: &str) -> bool {
        let hooks = self
            .read(["rev-parse", "--git-path", "hooks"])
            .await
            .unwrap_or_default();
        let dir = PathBuf::from(hooks.trim());
        let dir = if dir.is_absolute() {
            dir
        } else {
            self.path.join(dir)
        };
        dir.join(name).is_file()
    }

    // ---------- history ----------

    pub async fn log(&self, q: &LogQuery) -> AppResult<LogPage> {
        if self.is_unborn().await {
            return Ok(LogPage {
                commits: vec![],
                has_more: false,
            });
        }
        let limit = q.limit.clamp(1, 1000);
        let mut args: Vec<String> = vec![
            "log".into(),
            log::LOG_FORMAT.into(),
            "--decorate=short".into(),
            format!("--skip={}", q.skip),
            format!("--max-count={}", limit + 1),
        ];
        let search = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let mut hash_hit = None;
        if let Some(s) = search {
            if let Some(a) = s.strip_prefix("author:") {
                args.push(format!("--author={}", a.trim()));
                args.push("--regexp-ignore-case".into());
                args.push("--fixed-strings".into());
            } else {
                args.push(format!("--grep={s}"));
                args.push("--regexp-ignore-case".into());
                args.push("--fixed-strings".into());
                if q.skip == 0 && s.len() >= 4 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                    hash_hit = self
                        .git
                        .run(
                            self.path,
                            [
                                "rev-parse",
                                "--verify",
                                "--quiet",
                                &format!("{s}^{{commit}}"),
                            ],
                            RunOpts::read(),
                        )
                        .await
                        .ok()
                        .map(|o| o.text().trim().to_string());
                }
            }
        }
        let rev = match &q.rev {
            Some(r) => v::revision(r)?.to_string(),
            None => "HEAD".into(),
        };
        if q.path.is_some() {
            args.push("--follow".into());
        }
        args.push(rev);
        args.push("--".into());
        if let Some(p) = &q.path {
            args.push(v::rel_path(p)?.into());
        }
        let mut commits = log::parse_log(&self.read(&args).await?);
        let has_more = commits.len() as u32 > limit;
        commits.truncate(limit as usize);
        if let Some(h) = hash_hit {
            if !commits.iter().any(|c| c.hash == h) {
                let one = self
                    .read(["log", log::LOG_FORMAT, "--decorate=short", "-n1", &h, "--"])
                    .await?;
                let mut extra = log::parse_log(&one);
                extra.append(&mut commits);
                commits = extra;
            }
        }
        Ok(LogPage { commits, has_more })
    }

    pub async fn commit_detail(&self, hash: &str) -> AppResult<CommitDetail> {
        let hash = v::commit_hash(hash)?;
        let head = self
            .read([
                "log",
                log::LOG_FORMAT,
                "--decorate=short",
                "-n1",
                hash,
                "--",
            ])
            .await?;
        let summary = log::parse_log(&head)
            .pop()
            .ok_or_else(|| AppError::invalid("That commit wasn't found."))?;
        let message = self.read(["show", "-s", "--format=%B", hash, "--"]).await?;
        let first_parent = summary.parents.len() > 1;
        let base: Vec<&str> = vec!["diff-tree", "-r", "-M", "--root", "--no-commit-id", "-z"];
        let target: Vec<String> = if let Some(p) = summary.parents.first() {
            vec![p.clone(), hash.to_string()]
        } else {
            vec![hash.to_string()]
        };
        let mut ns_args: Vec<String> = base.iter().map(|s| s.to_string()).collect();
        ns_args.push("--name-status".into());
        ns_args.extend(target.iter().cloned());
        let mut num_args: Vec<String> = base.iter().map(|s| s.to_string()).collect();
        num_args.push("--numstat".into());
        num_args.extend(target.iter().cloned());
        let ns = self
            .git
            .run(self.path, &ns_args, RunOpts::read())
            .await?
            .stdout;
        let num = self
            .git
            .run(self.path, &num_args, RunOpts::read())
            .await?
            .stdout;
        Ok(CommitDetail {
            summary,
            message: message.trim_end().to_string(),
            files: log::parse_commit_files(&ns, &num),
            compared_to_first_parent: first_parent,
        })
    }

    pub async fn commit_file_diff(
        &self,
        hash: &str,
        path: &str,
        orig_path: Option<&str>,
    ) -> AppResult<FileDiff> {
        let hash = v::commit_hash(hash)?;
        let path = v::rel_path(path)?;
        let mut args: Vec<String> = vec![
            "-c".into(),
            "diff.noprefix=false".into(),
            "show".into(),
            "--format=".into(),
            "--diff-merges=first-parent".into(),
        ];
        args.extend(DIFF_FLAGS.iter().map(|s| s.to_string()));
        args.push(hash.into());
        args.push("--".into());
        args.push(path.into());
        if let Some(o) = orig_path {
            args.push(v::rel_path(o)?.into());
        }
        let raw = self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout;
        let mut files = diff::parse(&raw);
        let mut f = files.pop().unwrap_or_else(|| FileDiff {
            new_path: Some(path.to_string()),
            ..FileDiff::default()
        });
        f.hunk_actions = false;
        Ok(f)
    }

    // ---------- branches ----------

    pub async fn branches(&self) -> AppResult<Vec<Branch>> {
        let remotes: Vec<String> = self
            .read(["remote"])
            .await?
            .lines()
            .map(String::from)
            .collect();
        let raw = self
            .read([
                "for-each-ref",
                refs::BRANCH_FORMAT,
                "--sort=-committerdate",
                "refs/heads",
                "refs/remotes",
            ])
            .await?;
        let mut branches = refs::parse_branches(&raw, &remotes);
        if !self.is_unborn().await {
            let merged = self
                .read(["branch", "--merged", "HEAD", "--format=%(refname:short)"])
                .await
                .unwrap_or_default();
            let merged: std::collections::HashSet<&str> = merged.lines().collect();
            for b in branches.iter_mut().filter(|b| !b.is_remote) {
                b.merged = Some(merged.contains(b.name.as_str()));
            }
        }
        Ok(branches)
    }

    async fn check_branch_name(&self, name: &str) -> AppResult<String> {
        let name = v::ref_name(name)?;
        self.git
            .run(
                self.path,
                ["check-ref-format", "--branch", name],
                RunOpts::read(),
            )
            .await
            .map_err(|_| AppError::invalid(format!("'{name}' isn't a valid branch name.")))?;
        Ok(name.to_string())
    }

    pub async fn branch_create(
        &self,
        name: &str,
        start: Option<&str>,
        checkout: bool,
    ) -> AppResult<()> {
        let name = self.check_branch_name(name).await?;
        if checkout {
            let mut args = vec!["switch".to_string(), "-c".into(), name];
            if let Some(s) = start {
                args.push(v::revision(s)?.into());
            }
            self.write(&args).await?;
        } else {
            let mut args = vec!["branch".to_string(), name];
            if let Some(s) = start {
                args.push(v::revision(s)?.into());
            }
            self.write(&args).await?;
        }
        Ok(())
    }

    /// Switches branches. Git itself refuses if local changes would be overwritten;
    /// we never pass --force/--discard-changes.
    pub async fn branch_switch(&self, name: &str) -> AppResult<()> {
        let name = v::ref_name(name)?;
        self.write(["switch", "--no-guess", name]).await?;
        Ok(())
    }

    /// Creates a local branch tracking `remote_branch` (e.g. "origin/feature") and switches to it.
    pub async fn branch_checkout_remote(
        &self,
        remote_branch: &str,
        local_name: &str,
    ) -> AppResult<()> {
        let rb = v::ref_name(remote_branch)?;
        let local = self.check_branch_name(local_name).await?;
        self.write(["switch", "-c", &local, "--track", rb]).await?;
        Ok(())
    }

    pub async fn branch_rename(&self, old: &str, new: &str) -> AppResult<()> {
        let old = v::ref_name(old)?;
        let new = self.check_branch_name(new).await?;
        // -m (not -M) refuses to overwrite an existing branch.
        self.write(["branch", "-m", old, &new]).await?;
        Ok(())
    }

    pub async fn branch_delete(&self, name: &str, force: bool) -> AppResult<()> {
        let name = v::ref_name(name)?;
        let st = self.status().await?;
        if st.branch.head.as_deref() == Some(name) {
            return Err(AppError::invalid(
                "You can't delete the branch you're on. Switch to another branch first.",
            ));
        }
        self.write(["branch", if force { "-D" } else { "-d" }, name])
            .await?;
        Ok(())
    }

    pub async fn remote_branch_delete(&self, remote: &str, branch: &str) -> AppResult<()> {
        let remote = v::remote_name(remote)?;
        let branch = v::ref_name(branch)?;
        let mut args: Vec<&str> = NO_EXT.to_vec();
        args.extend(["push", remote, "--delete", branch]);
        self.git
            .run(
                self.path,
                args,
                RunOpts {
                    timeout: NETWORK_TIMEOUT,
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn branch_compare(&self, base: &str, head: &str) -> AppResult<BranchComparison> {
        let b = v::revision(base)?;
        let h = v::revision(head)?;
        let ahead = self
            .read([
                "log",
                log::LOG_FORMAT,
                "--max-count=200",
                &format!("{b}..{h}"),
                "--",
            ])
            .await?;
        let behind = self
            .read([
                "log",
                log::LOG_FORMAT,
                "--max-count=200",
                &format!("{h}..{b}"),
                "--",
            ])
            .await?;
        Ok(BranchComparison {
            base: b.into(),
            head: h.into(),
            ahead: log::parse_log(&ahead),
            behind: log::parse_log(&behind),
        })
    }

    pub async fn set_upstream(&self, branch: &str, upstream: Option<&str>) -> AppResult<()> {
        let branch = v::ref_name(branch)?;
        match upstream {
            Some(u) => {
                let u = v::ref_name(u)?;
                self.write(["branch", &format!("--set-upstream-to={u}"), branch])
                    .await?;
            }
            None => {
                self.write(["branch", "--unset-upstream", branch]).await?;
            }
        }
        Ok(())
    }

    // ---------- stash ----------

    pub async fn stash_list(&self) -> AppResult<Vec<Stash>> {
        let raw = self
            .git
            .run(
                self.path,
                ["stash", "list", "--format=%gd%x1f%ct%x1f%gs%x1e"],
                RunOpts::read(),
            )
            .await?
            .text();
        Ok(refs::parse_stashes(&raw))
    }

    pub async fn stash_push(&self, message: &str, include_untracked: bool) -> AppResult<()> {
        let msg = message.trim();
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        args.extend([
            "-m",
            if msg.is_empty() {
                "GitPilot stash"
            } else {
                msg
            },
        ]);
        self.write(args).await?;
        Ok(())
    }

    pub async fn stash_apply(&self, index: u32, pop: bool) -> AppResult<()> {
        let r = format!("stash@{{{index}}}");
        self.write(["stash", if pop { "pop" } else { "apply" }, &r])
            .await?;
        Ok(())
    }

    pub async fn stash_drop(&self, index: u32) -> AppResult<()> {
        let r = format!("stash@{{{index}}}");
        self.write(["stash", "drop", &r]).await?;
        Ok(())
    }

    // ---------- remotes ----------

    pub async fn remotes(&self) -> AppResult<Vec<Remote>> {
        Ok(refs::parse_remotes(&self.read(["remote", "-v"]).await?))
    }

    pub async fn remote_add(&self, name: &str, url: &str) -> AppResult<()> {
        let name = v::remote_name(name)?;
        let url = v::remote_url(url)?;
        self.write(["remote", "add", "--", name, url]).await?;
        Ok(())
    }

    pub async fn remote_set_url(&self, name: &str, url: &str) -> AppResult<()> {
        let name = v::remote_name(name)?;
        let url = v::remote_url(url)?;
        self.write(["remote", "set-url", "--", name, url]).await?;
        Ok(())
    }

    pub async fn remote_remove(&self, name: &str) -> AppResult<()> {
        let name = v::remote_name(name)?;
        self.write(["remote", "remove", name]).await?;
        Ok(())
    }

    // ---------- sync ----------

    pub async fn fetch<F: FnMut(String) + Send>(
        &self,
        remote: Option<&str>,
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<()> {
        let mut args: Vec<String> = NO_EXT.iter().map(|s| s.to_string()).collect();
        args.extend(["fetch".into(), "--progress".into(), "--prune".into()]);
        match remote {
            Some(r) => args.push(v::remote_name(r)?.into()),
            None => args.push("--all".into()),
        }
        self.git
            .run_streaming(self.path, &args, NETWORK_TIMEOUT, cancel, on)
            .await?;
        Ok(())
    }

    /// Pulls into the current branch. Without an upstream, pulls from the same-named remote
    /// branch (if one exists) and links the branch to it once the pull succeeds.
    pub async fn pull<F: FnMut(String) + Send>(
        &self,
        default_strategy: PullStrategy,
        opts: PullOptions,
        on: F,
    ) -> AppResult<()> {
        let st = self.status().await?;
        if st.branch.detached {
            return Err(AppError::invalid(
                "You're not on a branch (detached HEAD), so there's nothing to pull into.",
            ));
        }
        let twin = if st.branch.upstream.is_none() {
            Some(st.remote_twin.clone().ok_or_else(|| {
                AppError::new(
                    ErrorKind::NoUpstream,
                    "This branch isn't connected to a remote branch, and the remote has no branch with the same name. Fetch first, or publish this branch.",
                )
            })?)
        } else {
            None
        };
        let strategy = opts.strategy.unwrap_or(default_strategy);
        let mut args: Vec<String> = NO_EXT.iter().map(|s| s.to_string()).collect();
        args.extend(["pull".into(), "--progress".into(), "--no-edit".into()]);
        args.push(match strategy {
            PullStrategy::FfOnly => "--ff-only".into(),
            PullStrategy::Merge => "--no-rebase".into(),
            PullStrategy::Rebase => "--rebase".into(),
        });
        if opts.allow_unrelated {
            args.push("--allow-unrelated-histories".into());
        }
        if let Some(t) = &twin {
            args.push(v::remote_name(&t.remote)?.to_string());
            args.push(v::ref_name(&t.branch)?.to_string());
        }
        let mut result = self
            .git
            .run_streaming(self.path, &args, NETWORK_TIMEOUT, None, on)
            .await;
        // Fast-forward-only pulls report "diverged" even when the branches share no history at all.
        // Say what's really going on so the user gets the right choice straight away.
        if let Err(e) = &result {
            if e.kind == ErrorKind::Diverged && !opts.allow_unrelated {
                let target = twin
                    .as_ref()
                    .map(|t| t.name.clone())
                    .unwrap_or_else(|| "@{upstream}".into());
                let no_base = self
                    .git
                    .run(
                        self.path,
                        ["merge-base", "HEAD", &target],
                        RunOpts {
                            ok_codes: &[1],
                            read_only: true,
                            ..RunOpts::default()
                        },
                    )
                    .await
                    .map(|o| o.code == 1)
                    .unwrap_or(false);
                if no_base {
                    result = Err(super::errors::classify(
                        "fatal: refusing to merge unrelated histories",
                    ));
                }
            }
        }
        // Link the branch even if the pull stopped for conflicts: the remote branch is now part of it.
        if let Some(t) = &twin {
            let linked =
                result.is_ok() || matches!(&result, Err(e) if e.kind == ErrorKind::Conflict);
            if linked {
                let _ = self
                    .write([
                        "branch",
                        &format!("--set-upstream-to={}", t.name),
                        &t.branch,
                    ])
                    .await;
            }
        }
        result.map(|_| ())
    }

    /// Pushes the current branch. `set_upstream` publishes it; `force_with_lease` is only
    /// used after an explicit, separately-confirmed user action.
    pub async fn push<F: FnMut(String) + Send>(
        &self,
        remote: Option<&str>,
        set_upstream: bool,
        force_with_lease: bool,
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<()> {
        let st = self.status().await?;
        if st.branch.head.is_none() {
            return Err(AppError::invalid(
                "You're not on a branch (detached HEAD). Create a branch to push.",
            ));
        }
        if st.branch.unborn {
            return Err(AppError::invalid("There are no commits to push yet."));
        }
        let mut args: Vec<String> = NO_EXT.iter().map(|s| s.to_string()).collect();
        args.extend(["push".into(), "--progress".into()]);
        if force_with_lease {
            args.push("--force-with-lease".into());
        }
        if set_upstream || st.branch.upstream.is_none() {
            let remote = match remote {
                Some(r) => v::remote_name(r)?.to_string(),
                None => self
                    .remotes()
                    .await?
                    .first()
                    .map(|r| r.name.clone())
                    .ok_or_else(|| AppError::invalid("Add a remote before pushing."))?,
            };
            args.extend(["--set-upstream".into(), remote, "HEAD".into()]);
        } else if let Some(r) = remote {
            args.extend([v::remote_name(r)?.to_string(), "HEAD".into()]);
        }
        self.git
            .run_streaming(self.path, &args, NETWORK_TIMEOUT, cancel, on)
            .await?;
        Ok(())
    }

    // ---------- identity ----------

    pub async fn identity(&self) -> AppResult<Identity> {
        let get = |key: &'static str| async move {
            self.git
                .run(
                    self.path,
                    ["config", "--get", key],
                    RunOpts {
                        ok_codes: &[1],
                        read_only: true,
                        ..RunOpts::default()
                    },
                )
                .await
                .map(|o| Some(o.text().trim().to_string()).filter(|s| !s.is_empty()))
        };
        Ok(Identity {
            name: get("user.name").await?,
            email: get("user.email").await?,
        })
    }

    /// Writes identity to this repository's config (`global=false`) or the user's global config.
    pub async fn set_identity(&self, name: &str, email: &str, global: bool) -> AppResult<()> {
        let (name, email) = (name.trim(), email.trim());
        if name.is_empty() || !email.contains('@') || name.contains('\n') || email.contains('\n') {
            return Err(AppError::invalid("Enter a name and a valid email address."));
        }
        let scope = if global { "--global" } else { "--local" };
        self.write(["config", scope, "user.name", name]).await?;
        self.write(["config", scope, "user.email", email]).await?;
        Ok(())
    }

    // ---------- integrating changes ----------

    async fn is_merge_commit(&self, hash: &str) -> AppResult<bool> {
        let parents = self
            .read(["rev-list", "--parents", "-n", "1", hash])
            .await?;
        Ok(parents.split_whitespace().count() > 2)
    }

    /// Merges `branch` into the current branch. Stops (without committing) on conflicts.
    pub async fn merge(&self, branch: &str) -> AppResult<()> {
        let b = v::revision(branch)?;
        self.write(["merge", "--no-edit", b]).await?;
        Ok(())
    }

    /// Rebases the current branch onto `onto`. Rewrites the current branch's commits.
    pub async fn rebase(&self, onto: &str) -> AppResult<()> {
        let o = v::revision(onto)?;
        let st = self.status().await?;
        if st.branch.detached || st.branch.unborn {
            return Err(AppError::invalid(
                "Switch to a branch with commits before rebasing.",
            ));
        }
        self.write(["rebase", o]).await?;
        Ok(())
    }

    /// Applies one commit on top of the current branch. Merge commits use their first parent.
    pub async fn cherry_pick(&self, hash: &str) -> AppResult<()> {
        let h = v::commit_hash(hash)?;
        let mut args = vec!["cherry-pick"];
        if self.is_merge_commit(h).await? {
            args.extend(["-m", "1"]);
        }
        args.push(h);
        self.write(args).await?;
        Ok(())
    }

    /// Creates a new commit that undoes `hash`. Merge commits are reverted against their first parent.
    pub async fn revert(&self, hash: &str) -> AppResult<()> {
        let h = v::commit_hash(hash)?;
        let mut args = vec!["revert", "--no-edit"];
        if self.is_merge_commit(h).await? {
            args.extend(["-m", "1"]);
        }
        args.push(h);
        self.write(args).await?;
        Ok(())
    }

    /// Continues, skips or aborts whatever multi-step operation is in progress.
    pub async fn sequence(&self, action: SequenceAction) -> AppResult<()> {
        let state = self.status().await?.state;
        let cmd = match state {
            RepoState::Rebasing => "rebase",
            RepoState::CherryPicking => "cherry-pick",
            RepoState::Reverting => "revert",
            RepoState::Merging => "merge",
            _ => {
                return Err(AppError::invalid(
                    "There's no merge, rebase, cherry-pick or revert in progress.",
                ))
            }
        };
        let flag = match action {
            SequenceAction::Continue => "--continue",
            SequenceAction::Skip => "--skip",
            SequenceAction::Abort => "--abort",
        };
        if state == RepoState::Merging && action == SequenceAction::Skip {
            return Err(AppError::invalid(
                "A merge can't be skipped. Abort it or finish it.",
            ));
        }
        self.write([cmd, flag]).await?;
        Ok(())
    }

    /// Stages (or unstages) only the selected lines of one hunk.
    pub async fn apply_lines(
        &self,
        path: &str,
        hunk_header: &str,
        lines: &[u32],
        unstage: bool,
    ) -> AppResult<()> {
        let path = v::rel_path(path)?;
        if lines.is_empty() {
            return Err(AppError::invalid("Select at least one changed line."));
        }
        let raw = self.raw_diff(path, unstage, None).await?;
        let patch = diff::patch_for_lines(&raw, hunk_header, lines, unstage).ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidInput,
                "This change was modified since it was displayed. Refresh and try again.",
            )
        })?;
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if unstage {
            args.push("--reverse");
        }
        args.push("-");
        self.git
            .run(
                self.path,
                args,
                RunOpts {
                    stdin: Some(&patch),
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok(())
    }

    /// Tracked files whose path contains `query` (case-insensitive), for quick navigation.
    pub async fn search_files(&self, query: &str, limit: usize) -> AppResult<Vec<String>> {
        let raw = self
            .read([
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ])
            .await?;
        let q = query.trim().to_lowercase();
        let mut out: Vec<String> = raw
            .split('\0')
            .filter(|p| !p.is_empty() && (q.is_empty() || p.to_lowercase().contains(&q)))
            .take(limit * 4)
            .map(String::from)
            .collect();
        // Prefer matches in the file name over matches in directories.
        out.sort_by_key(|p| {
            let name = p.rsplit('/').next().unwrap_or(p).to_lowercase();
            (!name.contains(&q), p.len())
        });
        out.truncate(limit);
        Ok(out)
    }

    /// The staged diff, used for AI commit-message generation.
    pub async fn staged_diff_raw(&self) -> AppResult<Vec<u8>> {
        let mut args: Vec<String> = vec![
            "-c".into(),
            "diff.noprefix=false".into(),
            "diff".into(),
            "--cached".into(),
        ];
        args.extend(DIFF_FLAGS.iter().map(|s| s.to_string()));
        Ok(self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout)
    }
}

/// Global identity (no repository needed).
pub async fn global_identity(git: &Git) -> AppResult<Identity> {
    let home = std::env::temp_dir();
    let get = |key: &'static str| {
        let home = home.clone();
        async move {
            git.run(
                &home,
                ["config", "--global", "--get", key],
                RunOpts {
                    ok_codes: &[1],
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await
            .map(|o| Some(o.text().trim().to_string()).filter(|s| !s.is_empty()))
        }
    };
    Ok(Identity {
        name: get("user.name").await?,
        email: get("user.email").await?,
    })
}

pub async fn git_version(git: &Git) -> AppResult<String> {
    let out = git.read(&std::env::temp_dir(), ["--version"]).await?;
    Ok(out.trim().trim_start_matches("git version ").to_string())
}

pub(crate) fn chrono_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{secs}")
}
