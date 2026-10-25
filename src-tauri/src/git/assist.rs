//! What GitPilot sends to AI providers for explanations and pull request descriptions.
//! Reads only; the caller filters sensitive files and caps the size (`ai::prepare_diff`).

use super::repo::{Repo, DIFF_FLAGS};
use super::runner::RunOpts;
use super::status::Area;
use super::validate as v;
use crate::error::{AppError, AppResult};

/// Most commit messages included in a pull request description request.
const MAX_PR_COMMITS: usize = 100;

impl Repo<'_> {
    /// A commit's full diff (merge commits against their first parent).
    pub async fn commit_diff_raw(&self, hash: &str) -> AppResult<Vec<u8>> {
        let hash = v::commit_hash(hash)?;
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
        Ok(self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout)
    }

    /// One file's uncommitted changes as a diff. New (untracked) files are shown as added.
    pub async fn change_diff_raw(
        &self,
        path: &str,
        area: Area,
        orig_path: Option<&str>,
    ) -> AppResult<Vec<u8>> {
        let path = v::rel_path(path)?;
        match area {
            Area::Staged => self.raw_diff(path, true, orig_path).await,
            Area::Unstaged => self.raw_diff(path, false, orig_path).await,
            Area::Untracked => {
                let bytes = std::fs::read(self.path.join(path))?;
                if bytes.contains(&0) {
                    return Err(AppError::invalid("Binary files can't be explained."));
                }
                let text = String::from_utf8_lossy(&bytes);
                let mut out = format!(
                    "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
                );
                for line in text.lines() {
                    out.push('+');
                    out.push_str(line);
                    out.push('\n');
                }
                Ok(out.into_bytes())
            }
            Area::Conflicted => Err(AppError::invalid(
                "Use conflict help for files with conflicts.",
            )),
        }
    }

    /// Commit messages (oldest first) and the diff of HEAD since it split from `base`.
    pub async fn branch_changes_since(&self, base: &str) -> AppResult<(String, Vec<u8>)> {
        let base = v::revision(base)?;
        let known = self
            .git
            .run(
                self.path,
                [
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("{base}^{{commit}}"),
                ],
                RunOpts {
                    ok_codes: &[1],
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await?
            .code
            == 0;
        if !known {
            return Err(AppError::invalid(format!(
                "GitPilot doesn't have {base} on this computer yet. Fetch, then try again."
            )));
        }
        let range = format!("{base}..HEAD");
        let raw = self
            .git
            .read(
                self.path,
                [
                    "log",
                    "--reverse",
                    "--no-merges",
                    "--format=%s%x1f%b%x1e",
                    &range,
                    "--",
                ],
            )
            .await?;
        let mut commits = String::new();
        for (i, rec) in raw
            .split('\x1e')
            .map(|r| r.trim_start_matches('\n'))
            .filter(|r| !r.is_empty())
            .enumerate()
        {
            if i == MAX_PR_COMMITS {
                commits.push_str("- (more commits not shown)\n");
                break;
            }
            let (subject, body) = rec.split_once('\x1f').unwrap_or((rec, ""));
            commits.push_str(&format!("- {}\n", subject.trim()));
            for l in body.trim().lines() {
                commits.push_str(&format!("  {l}\n"));
            }
        }
        let mut args: Vec<String> = vec!["-c".into(), "diff.noprefix=false".into(), "diff".into()];
        args.extend(DIFF_FLAGS.iter().map(|s| s.to_string()));
        args.push(format!("{base}...HEAD"));
        args.push("--".into());
        let diff = self
            .git
            .run(self.path, &args, RunOpts::read())
            .await?
            .stdout;
        Ok((commits, diff))
    }
}
