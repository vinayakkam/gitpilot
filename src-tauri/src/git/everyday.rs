//! Everyday operations added in 0.4.0: amend/undo the last commit, tags, and discarding
//! individual hunks or lines from the working tree.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::diff;
use super::repo::{chrono_stamp, Repo, NO_EXT};
use super::runner::{RunOpts, NETWORK_TIMEOUT};
use super::validate as v;
use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LastCommit {
    pub hash: String,
    /// Full message (subject + body).
    pub message: String,
    /// The commit exists on a remote-tracking branch, so changing it rewrites shared history.
    pub pushed: bool,
    pub is_merge: bool,
    /// The repository's first commit.
    pub is_root: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Tag {
    pub name: String,
    /// Commit the tag points to.
    pub target: String,
    /// Annotated tags carry their own message and tagger.
    pub annotated: bool,
    pub message: String,
    #[ts(type = "number")]
    pub time: i64,
}

pub fn parse_tags(raw: &str) -> Vec<Tag> {
    raw.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let f: Vec<&str> = rec.split('\x1f').collect();
            if f.len() < 6 {
                return None;
            }
            let annotated = f[1] == "tag";
            Some(Tag {
                name: f[0].to_string(),
                target: if annotated && !f[2].is_empty() {
                    f[2]
                } else {
                    f[3]
                }
                .to_string(),
                annotated,
                time: f[4].trim().parse().unwrap_or(0),
                message: f[5].trim().to_string(),
            })
        })
        .collect()
}

impl Repo<'_> {
    async fn rd(&self, args: &[&str]) -> AppResult<String> {
        Ok(self.git.run(self.path, args, RunOpts::read()).await?.text())
    }

    async fn wr(&self, args: &[&str]) -> AppResult<()> {
        self.git.run(self.path, args, RunOpts::default()).await?;
        Ok(())
    }

    /// The commit HEAD points to, or None in a repository without commits.
    pub async fn last_commit(&self) -> AppResult<Option<LastCommit>> {
        let Ok(out) = self
            .git
            .run(
                self.path,
                ["log", "-1", "--format=%H%x1f%P%x1f%B"],
                RunOpts::read(),
            )
            .await
        else {
            return Ok(None);
        };
        let text = out.text();
        let mut f = text.splitn(3, '\x1f');
        let hash = f.next().unwrap_or("").trim().to_string();
        if hash.is_empty() {
            return Ok(None);
        }
        let parents = f.next().unwrap_or("").split_whitespace().count();
        let message = f.next().unwrap_or("").trim_end().to_string();
        let pushed = !self
            .rd(&["branch", "-r", "--contains", &hash])
            .await
            .unwrap_or_default()
            .trim()
            .is_empty();
        Ok(Some(LastCommit {
            hash,
            message,
            pushed,
            is_merge: parents > 1,
            is_root: parents == 0,
        }))
    }

    /// Takes back the last commit: its changes return to the staging area (`reset --soft`)
    /// and its message is returned so it can be edited and committed again.
    pub async fn undo_last_commit(&self, confirmed_pushed: bool) -> AppResult<String> {
        let last = self
            .last_commit()
            .await?
            .ok_or_else(|| AppError::invalid("There's no commit to undo."))?;
        if last.is_merge {
            return Err(AppError::invalid(
                "The last commit is a merge. Undoing merges isn't supported here; use Revert in History instead.",
            ));
        }
        if last.pushed && !confirmed_pushed {
            return Err(AppError::invalid(
                "This commit has already been pushed. Confirm to undo it anyway.",
            ));
        }
        let state = self.status().await?.state;
        if state != super::repo::RepoState::Normal {
            return Err(AppError::invalid(
                "Finish or abort the merge, rebase or cherry-pick in progress first.",
            ));
        }
        if last.is_root {
            // No parent to go back to: drop the branch pointer; the files stay staged.
            self.wr(&["update-ref", "-d", "HEAD"]).await?;
        } else {
            self.wr(&["reset", "--soft", "HEAD~1"]).await?;
        }
        Ok(last.message)
    }

    // ---------- tags ----------

    pub async fn tags(&self) -> AppResult<Vec<Tag>> {
        let raw = self
            .rd(&[
                "for-each-ref",
                "refs/tags",
                "--sort=-creatordate",
                "--format=%(refname:short)%1f%(objecttype)%1f%(*objectname)%1f%(objectname)%1f%(creatordate:unix)%1f%(contents:subject)%1e",
            ])
            .await?;
        Ok(parse_tags(&raw))
    }

    /// Creates a tag on `target` (a commit). With a message it's an annotated tag.
    pub async fn tag_create(&self, name: &str, target: &str, message: &str) -> AppResult<()> {
        let name = v::ref_name(name.trim())?;
        let target = v::revision(target)?;
        let exists = self
            .git
            .run(
                self.path,
                [
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/tags/{name}"),
                ],
                RunOpts::read(),
            )
            .await
            .is_ok();
        if exists {
            return Err(AppError::invalid(format!(
                "A tag named '{name}' already exists."
            )));
        }
        let msg = message.trim();
        if msg.is_empty() {
            self.wr(&["tag", name, target]).await
        } else {
            self.git
                .run(
                    self.path,
                    ["tag", "-a", name, "-F", "-", target],
                    RunOpts {
                        stdin: Some(msg.as_bytes()),
                        ..RunOpts::default()
                    },
                )
                .await?;
            Ok(())
        }
    }

    pub async fn tag_delete(&self, name: &str) -> AppResult<()> {
        let name = v::ref_name(name)?;
        self.wr(&["tag", "-d", name]).await
    }

    /// Pushes one tag, or with `delete` removes it from the remote.
    pub async fn tag_push(&self, remote: &str, name: &str, delete: bool) -> AppResult<()> {
        let remote = v::remote_name(remote)?;
        let name = v::ref_name(name)?;
        let spec = if delete {
            format!(":refs/tags/{name}")
        } else {
            format!("refs/tags/{name}:refs/tags/{name}")
        };
        let mut args: Vec<String> = NO_EXT.iter().map(|s| s.to_string()).collect();
        args.extend(["push".into(), remote.into(), spec]);
        self.git
            .run(
                self.path,
                &args,
                RunOpts {
                    timeout: NETWORK_TIMEOUT,
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok(())
    }

    // ---------- discarding parts of a file ----------

    /// Throws away one hunk (or only `lines` of it) of a file's unstaged changes. The current
    /// file is copied to `backup_root/<timestamp>/` first.
    pub async fn discard_partial(
        &self,
        path: &str,
        hunk_header: &str,
        lines: Option<&[u32]>,
        backup_root: &Path,
    ) -> AppResult<Option<String>> {
        let path = v::rel_path(path)?;
        let raw = self.raw_diff(path, false, None).await?;
        let stale = || {
            AppError::new(
                ErrorKind::InvalidInput,
                "This change was modified since it was displayed. Refresh and try again.",
            )
        };
        // Built relative to the working copy, then applied in reverse to it:
        // selected additions are removed and selected deletions come back.
        let patch = match lines {
            Some(sel) if !sel.is_empty() => {
                diff::patch_for_lines(&raw, hunk_header, sel, true).ok_or_else(stale)?
            }
            Some(_) => return Err(AppError::invalid("Select the lines to discard.")),
            None => diff::patch_for_hunk(&raw, hunk_header).ok_or_else(stale)?,
        };
        let file = self.path.join(path);
        let mut backup = None;
        if file.is_file() {
            let dir = backup_root.join(chrono_stamp());
            let dst = dir.join(path);
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&file, &dst)?;
            backup = Some(dir.display().to_string());
        }
        self.git
            .run(
                self.path,
                [
                    "apply",
                    "--reverse",
                    "--recount",
                    "--whitespace=nowarn",
                    "-",
                ],
                RunOpts {
                    stdin: Some(&patch),
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok(backup)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags() {
        let raw = "v1.0\x1ftag\x1fabc\x1fdef\x1f1700000000\x1fFirst release\x1e\nlight\x1fcommit\x1f\x1f123\x1f1690000000\x1fsome commit\x1e\n";
        let t = parse_tags(raw);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].target, "abc");
        assert!(t[0].annotated);
        assert_eq!(t[1].target, "123");
        assert!(!t[1].annotated);
        assert_eq!(t[1].time, 1690000000);
    }
}
