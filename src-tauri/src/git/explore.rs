//! Understanding code (0.4.0): blame, comparing any two revisions file by file, and image
//! previews for image diffs.

use std::collections::HashMap;

use base64::Engine;
use serde::Serialize;
use ts_rs::TS;

use super::diff::{self, FileDiff, ImageDiff};
use super::log::{self, CommitFile};
use super::repo::Repo;
use super::runner::RunOpts;
use super::status::Area;
use super::validate as v;
use crate::error::{AppError, AppResult};

/// Lines beyond this aren't blamed (the result would be too large to show usefully).
const MAX_BLAME_LINES: usize = 20_000;
/// Images larger than this aren't previewed.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const UNCOMMITTED: &str = "0000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlameCommit {
    pub hash: String,
    pub author: String,
    #[ts(type = "number")]
    pub time: i64,
    pub summary: String,
    /// Lines changed in the working copy but not committed yet.
    pub uncommitted: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// Index into `BlameResult::commits`.
    pub commit: u32,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BlameResult {
    pub commits: Vec<BlameCommit>,
    pub lines: Vec<BlameLine>,
    pub truncated: bool,
}

/// Parses `git blame --porcelain`.
pub fn parse_blame(raw: &str) -> BlameResult {
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut index: HashMap<String, u32> = HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<u32> = None;
    let mut truncated = false;
    for line in raw.split('\n') {
        if let Some(content) = line.strip_prefix('\t') {
            if let Some(c) = current {
                if lines.len() >= MAX_BLAME_LINES {
                    truncated = true;
                    break;
                }
                lines.push(BlameLine {
                    commit: c,
                    content: content.to_string(),
                });
            }
            continue;
        }
        let mut parts = line.splitn(2, ' ');
        let first = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");
        if first.len() == 40 && first.chars().all(|c| c.is_ascii_hexdigit()) {
            let i = *index.entry(first.to_string()).or_insert_with(|| {
                commits.push(BlameCommit {
                    hash: first.to_string(),
                    author: String::new(),
                    time: 0,
                    summary: String::new(),
                    uncommitted: first == UNCOMMITTED,
                });
                (commits.len() - 1) as u32
            });
            current = Some(i);
            continue;
        }
        let Some(c) = current.and_then(|i| commits.get_mut(i as usize)) else {
            continue;
        };
        match first {
            "author" => c.author = rest.to_string(),
            "author-time" => c.time = rest.trim().parse().unwrap_or(0),
            "summary" => c.summary = rest.to_string(),
            _ => {}
        }
    }
    BlameResult {
        commits,
        lines,
        truncated,
    }
}

pub fn image_mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Where one side of an image diff comes from.
pub enum Side<'a> {
    /// `git cat-file blob <spec>`, e.g. ":path" or "HEAD:path".
    Blob(String),
    WorkingFile(&'a str),
    Nothing,
}

impl Repo<'_> {
    pub async fn blame(&self, path: &str, rev: Option<&str>) -> AppResult<BlameResult> {
        let path = v::rel_path(path)?;
        let mut args: Vec<String> = vec!["blame".into(), "--porcelain".into()];
        if let Some(r) = rev {
            args.push(v::revision(r)?.into());
        }
        args.push("--".into());
        args.push(path.into());
        let out = self.git.run(self.path, &args, RunOpts::read()).await?;
        Ok(parse_blame(&out.text()))
    }

    /// Files that differ between two revisions. With `three_dot`, `head` is compared with the
    /// point where it branched from `base` (what a pull request would contain).
    pub async fn compare_files(
        &self,
        base: &str,
        head: &str,
        three_dot: bool,
    ) -> AppResult<Vec<CommitFile>> {
        let range = range(base, head, three_dot)?;
        let mut ns = vec!["diff", "--no-ext-diff", "-M", "-z", "--name-status"];
        ns.push(&range);
        let mut num = vec!["diff", "--no-ext-diff", "-M", "-z", "--numstat"];
        num.push(&range);
        let ns = self.git.run(self.path, &ns, RunOpts::read()).await?.stdout;
        let num = self.git.run(self.path, &num, RunOpts::read()).await?.stdout;
        Ok(log::parse_commit_files(&ns, &num))
    }

    pub async fn compare_file_diff(
        &self,
        base: &str,
        head: &str,
        three_dot: bool,
        path: &str,
        orig_path: Option<&str>,
    ) -> AppResult<FileDiff> {
        let range = range(base, head, three_dot)?;
        let path = v::rel_path(path)?;
        let mut args: Vec<String> = vec![
            "-c".into(),
            "diff.noprefix=false".into(),
            "diff".into(),
            "--no-color".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "--src-prefix=a/".into(),
            "--dst-prefix=b/".into(),
            "-M".into(),
            range.clone(),
            "--".into(),
            path.into(),
        ];
        if let Some(o) = orig_path {
            args.push(v::rel_path(o)?.into());
        }
        let raw = self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout;
        let mut f = diff::parse(&raw).pop().unwrap_or_else(|| FileDiff {
            new_path: Some(path.to_string()),
            ..FileDiff::default()
        });
        f.hunk_actions = false;
        if f.binary && image_mime(path).is_some() {
            let old_base = if three_dot {
                self.git
                    .run(self.path, ["merge-base", base, head], RunOpts::read())
                    .await
                    .map(|o| o.text().trim().to_string())
                    .unwrap_or_else(|_| base.to_string())
            } else {
                base.to_string()
            };
            let old = format!("{old_base}:{}", orig_path.unwrap_or(path));
            self.attach_image(
                &mut f,
                path,
                Side::Blob(old),
                Side::Blob(format!("{head}:{path}")),
            )
            .await;
        }
        Ok(f)
    }

    async fn side_bytes(&self, side: &Side<'_>) -> Option<Vec<u8>> {
        match side {
            Side::Blob(spec) => {
                let out = self
                    .git
                    .run(
                        self.path,
                        ["cat-file", "blob", spec.as_str()],
                        RunOpts::read(),
                    )
                    .await
                    .ok()?;
                Some(out.stdout)
            }
            Side::WorkingFile(p) => std::fs::read(self.path.join(p)).ok(),
            Side::Nothing => None,
        }
    }

    /// Adds before/after previews to a binary diff of an image file.
    pub async fn attach_image(&self, f: &mut FileDiff, path: &str, old: Side<'_>, new: Side<'_>) {
        let Some(mime) = image_mime(path) else {
            return;
        };
        let mut img = ImageDiff::default();
        if let Some(b) = self.side_bytes(&old).await.filter(|b| !b.is_empty()) {
            img.old_size = Some(b.len() as u64);
            if b.len() <= MAX_IMAGE_BYTES {
                img.old = Some(data_url(mime, &b));
            }
        }
        if let Some(b) = self.side_bytes(&new).await.filter(|b| !b.is_empty()) {
            img.new_size = Some(b.len() as u64);
            if b.len() <= MAX_IMAGE_BYTES {
                img.new = Some(data_url(mime, &b));
            }
        }
        if img.old.is_some() || img.new.is_some() {
            f.image = Some(img);
        }
    }

    /// Image previews for a working-tree diff.
    pub async fn attach_worktree_image(
        &self,
        f: &mut FileDiff,
        path: &str,
        area: Area,
        orig_path: Option<&str>,
    ) {
        if image_mime(path).is_none() || !(f.binary || area == Area::Untracked) {
            return;
        }
        let (old, new) = match area {
            Area::Unstaged => (Side::Blob(format!(":{path}")), Side::WorkingFile(path)),
            Area::Staged => (
                Side::Blob(format!("HEAD:{}", orig_path.unwrap_or(path))),
                Side::Blob(format!(":{path}")),
            ),
            Area::Untracked => (Side::Nothing, Side::WorkingFile(path)),
            Area::Conflicted => return,
        };
        self.attach_image(f, path, old, new).await;
    }

    /// Image previews for a file in a commit (compared with its first parent).
    pub async fn attach_commit_image(
        &self,
        f: &mut FileDiff,
        hash: &str,
        path: &str,
        orig_path: Option<&str>,
    ) {
        if !f.binary || image_mime(path).is_none() {
            return;
        }
        let old = Side::Blob(format!("{hash}^1:{}", orig_path.unwrap_or(path)));
        self.attach_image(f, path, old, Side::Blob(format!("{hash}:{path}")))
            .await;
    }
}

fn range(base: &str, head: &str, three_dot: bool) -> AppResult<String> {
    let base = v::revision(base)?;
    let head = v::revision(head)?;
    if base.is_empty() || head.is_empty() {
        return Err(AppError::invalid(
            "Choose two branches or commits to compare.",
        ));
    }
    Ok(format!(
        "{base}{}{head}",
        if three_dot { "..." } else { ".." }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_blame() {
        let a = "a".repeat(40);
        let raw = format!(
            "{a} 1 1 2\nauthor Ann\nauthor-mail <a@x>\nauthor-time 1700000000\nauthor-tz +0000\nsummary First\nfilename f.txt\n\tline one\n{a} 2 2\n\tline two\n{UNCOMMITTED} 3 3 1\nauthor Not Committed Yet\nauthor-time 1800000000\nsummary Version of f.txt from f.txt\nfilename f.txt\n\tnew line\n"
        );
        let b = parse_blame(&raw);
        assert_eq!(b.commits.len(), 2);
        assert_eq!(b.lines.len(), 3);
        assert_eq!(b.commits[0].author, "Ann");
        assert_eq!(b.commits[0].summary, "First");
        assert_eq!(b.lines[1].commit, 0);
        assert!(b.commits[1].uncommitted);
        assert_eq!(b.lines[2].content, "new line");
    }

    #[test]
    fn image_types() {
        assert_eq!(image_mime("a/b/logo.PNG"), Some("image/png"));
        assert_eq!(image_mime("x.svg"), None);
        assert_eq!(image_mime("noext"), None);
    }
}
