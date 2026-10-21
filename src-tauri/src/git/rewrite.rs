//! Conflicts and history (0.4.0): resolving conflict blocks, interactive rebase, and resetting
//! a branch with an automatic backup.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::repo::{chrono_stamp, Repo, RepoState};
use super::runner::RunOpts;
use super::validate as v;
use crate::error::{AppError, AppResult};

// ---------- conflicts ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConflictChoice {
    /// The current branch's version ("ours").
    Current,
    /// The version being merged in ("theirs").
    Incoming,
    /// Current, then incoming.
    Both,
}

/// Replaces conflict block `index` (0-based) in `text` with the chosen side.
/// Returns the new text and how many conflict blocks are left, or None if there's no such block.
pub fn resolve_block(text: &str, index: usize, choice: ConflictChoice) -> Option<(String, usize)> {
    #[derive(PartialEq)]
    enum S {
        Out,
        Ours,
        Base,
        Theirs,
    }
    let mut out = String::with_capacity(text.len());
    let mut state = S::Out;
    let mut n = 0usize;
    let mut found = false;
    let (mut ours, mut theirs, mut block) = (String::new(), String::new(), String::new());
    let mut remaining = 0usize;
    for line in text.split_inclusive('\n') {
        let c = line.trim_end_matches('\n').trim_end_matches('\r');
        match state {
            S::Out if c.starts_with("<<<<<<<") => {
                state = S::Ours;
                ours.clear();
                theirs.clear();
                block.clear();
                block.push_str(line);
            }
            S::Out => out.push_str(line),
            S::Ours | S::Base if c.starts_with("=======") => {
                state = S::Theirs;
                block.push_str(line);
            }
            S::Ours if c.starts_with("|||||||") => {
                state = S::Base;
                block.push_str(line);
            }
            S::Ours => {
                ours.push_str(line);
                block.push_str(line);
            }
            S::Base => block.push_str(line),
            S::Theirs if c.starts_with(">>>>>>>") => {
                block.push_str(line);
                if n == index {
                    found = true;
                    match choice {
                        ConflictChoice::Current => out.push_str(&ours),
                        ConflictChoice::Incoming => out.push_str(&theirs),
                        ConflictChoice::Both => {
                            out.push_str(&ours);
                            if !ours.is_empty() && !ours.ends_with('\n') {
                                out.push('\n');
                            }
                            out.push_str(&theirs);
                        }
                    }
                } else {
                    out.push_str(&block);
                    remaining += 1;
                }
                n += 1;
                state = S::Out;
            }
            S::Theirs => {
                theirs.push_str(line);
                block.push_str(line);
            }
        }
    }
    // An unterminated block is left exactly as it was.
    if state != S::Out {
        out.push_str(&block);
    }
    found.then_some((out, remaining))
}

// ---------- interactive rebase ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RebaseAction {
    Pick,
    /// Keep the changes, replace the message.
    Reword,
    /// Combine into the previous commit, joining messages (or using `message`).
    Squash,
    /// Combine into the previous commit, keeping only the previous message.
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RebaseStep {
    pub hash: String,
    pub action: RebaseAction,
    /// New message for reword (and optionally squash).
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RebaseCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub message: String,
    pub author: String,
    #[ts(type = "number")]
    pub time: i64,
    pub is_merge: bool,
    pub pushed: bool,
}

/// Quotes a path for the POSIX shell Git uses to run editors and `exec` lines (on Windows too).
fn sh_quote(p: &std::path::Path) -> String {
    let s = p.display().to_string().replace('\\', "/");
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Builds the rebase todo list. Reword/squash messages are applied by an `exec` that amends
/// the commit with a message file, so Git never needs an editor.
pub fn build_todo(steps: &[RebaseStep], msg_file: impl Fn(usize) -> String) -> AppResult<String> {
    let mut todo = String::new();
    let mut kept = 0;
    for (i, s) in steps.iter().enumerate() {
        let verb = match s.action {
            RebaseAction::Pick | RebaseAction::Reword => "pick",
            RebaseAction::Squash => "squash",
            RebaseAction::Fixup => "fixup",
            RebaseAction::Drop => "drop",
        };
        if matches!(s.action, RebaseAction::Squash | RebaseAction::Fixup) && kept == 0 {
            return Err(AppError::invalid(
                "The first kept commit can't be combined into a previous one. Keep or remove it instead.",
            ));
        }
        if s.action != RebaseAction::Drop {
            kept += 1;
        }
        todo.push_str(&format!("{verb} {}\n", s.hash));
        let wants_message = matches!(s.action, RebaseAction::Reword | RebaseAction::Squash);
        if wants_message {
            if s.message.as_deref().is_some_and(|m| !m.trim().is_empty()) {
                todo.push_str(&format!(
                    "exec git commit --amend --only --no-verify --allow-empty -F {}\n",
                    msg_file(i)
                ));
            } else if s.action == RebaseAction::Reword {
                return Err(AppError::invalid(
                    "Write the new message for each commit you reword.",
                ));
            }
        }
    }
    if kept == 0 {
        return Err(AppError::invalid(
            "Keep at least one commit. To remove all of them, reset the branch instead.",
        ));
    }
    Ok(todo)
}

// ---------- reset ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ResetMode {
    /// Move the branch; changes from the removed commits stay staged.
    Soft,
    /// Move the branch; changes stay in the files, unstaged.
    Mixed,
    /// Move the branch and make the files match the commit. Uncommitted work is backed up.
    Hard,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Backup {
    /// Full ref name, e.g. refs/gitpilot/backups/1700000000000-main
    pub name: String,
    pub hash: String,
    pub subject: String,
    #[ts(type = "number")]
    pub time: i64,
    /// What it was made for, e.g. "before reset of main".
    pub label: String,
    /// Uncommitted changes saved alongside (a stash-like commit), if any.
    pub wip: Option<String>,
}

const BACKUP_NS: &str = "refs/gitpilot/backups/";

impl Repo<'_> {
    async fn rw(&self, args: &[&str]) -> AppResult<String> {
        Ok(self
            .git
            .run(self.path, args, RunOpts::default())
            .await?
            .text())
    }

    async fn ro(&self, args: &[&str]) -> AppResult<String> {
        Ok(self.git.run(self.path, args, RunOpts::read()).await?.text())
    }

    /// Resolves one conflict block in a conflicted file. Returns the blocks still left.
    pub async fn conflict_resolve_block(
        &self,
        path: &str,
        index: usize,
        choice: ConflictChoice,
    ) -> AppResult<usize> {
        let path = v::rel_path(path)?;
        let file = self.path.join(path);
        let bytes = std::fs::read(&file)?;
        let text = String::from_utf8(bytes).map_err(|_| {
            AppError::invalid("This file isn't plain text. Choose a whole version of it instead.")
        })?;
        let (new, left) = resolve_block(&text, index, choice).ok_or_else(|| {
            AppError::invalid(
                "That conflict wasn't found. The file may have changed; refresh and try again.",
            )
        })?;
        std::fs::write(&file, new)?;
        Ok(left)
    }

    /// Uses one side's whole version of a conflicted file (works for binary files too).
    pub async fn conflict_take_side(&self, path: &str, current: bool) -> AppResult<()> {
        let path = v::rel_path(path)?;
        let side = if current { "--ours" } else { "--theirs" };
        self.rw(&["checkout", side, "--", path]).await?;
        Ok(())
    }

    /// Commits from `base` (exclusive; None = from the first commit) to HEAD, oldest first.
    pub async fn rebase_commits(&self, base: Option<&str>) -> AppResult<Vec<RebaseCommit>> {
        let range = match base {
            Some(b) => format!("{}..HEAD", v::revision(b)?),
            None => "HEAD".to_string(),
        };
        let raw = self
            .ro(&[
                "log",
                "--reverse",
                "--format=%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%s%x1f%B%x1e",
                &range,
                "--",
            ])
            .await?;
        let remote_raw = self
            .ro(&["rev-list", &range, "--not", "--remotes"])
            .await
            .unwrap_or_default();
        let unpushed: std::collections::HashSet<&str> = remote_raw.lines().collect();
        let mut out = Vec::new();
        for rec in raw.split('\x1e') {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                continue;
            }
            let f: Vec<&str> = rec.splitn(7, '\x1f').collect();
            if f.len() < 7 {
                continue;
            }
            out.push(RebaseCommit {
                hash: f[0].into(),
                short_hash: f[1].into(),
                is_merge: f[2].split_whitespace().count() > 1,
                author: f[3].into(),
                time: f[4].trim().parse().unwrap_or(0),
                subject: f[5].into(),
                message: f[6].trim_end().into(),
                pushed: !unpushed.contains(f[0]),
            });
        }
        Ok(out)
    }

    /// Rewrites the commits after `base` according to `steps` (which must list exactly those
    /// commits, in the new order). A backup ref is made first. Stops for conflicts like any
    /// rebase; Continue/Skip/Abort then apply.
    pub async fn rebase_interactive(
        &self,
        base: Option<&str>,
        steps: &[RebaseStep],
        confirmed_pushed: bool,
    ) -> AppResult<Backup> {
        let st = self.status().await?;
        if st.state != RepoState::Normal {
            return Err(AppError::invalid(
                "Finish or abort the merge, rebase or cherry-pick in progress first.",
            ));
        }
        let Some(branch) = st.branch.head.clone() else {
            return Err(AppError::invalid(
                "Switch to a branch before editing its commits.",
            ));
        };
        if st
            .files
            .iter()
            .any(|f| f.area != super::status::Area::Untracked)
        {
            return Err(AppError::invalid(
                "Commit or stash your changes first, so editing commits can't mix them in.",
            ));
        }
        let commits = self.rebase_commits(base).await?;
        if commits.iter().any(|c| c.is_merge) {
            return Err(AppError::invalid(
                "These commits include a merge. Editing history across merges isn't supported here.",
            ));
        }
        let mut want: Vec<&str> = commits.iter().map(|c| c.hash.as_str()).collect();
        let mut got: Vec<&str> = steps.iter().map(|s| s.hash.as_str()).collect();
        want.sort_unstable();
        got.sort_unstable();
        if want != got {
            return Err(AppError::invalid(
                "The branch changed since you opened this. Close it and try again.",
            ));
        }
        if commits.iter().any(|c| c.pushed) && !confirmed_pushed {
            return Err(AppError::invalid(
                "Some of these commits are already pushed. Confirm to rewrite them anyway.",
            ));
        }

        let work = tempfile::Builder::new()
            .prefix("gitpilot-rebase-")
            .tempdir()?;
        let mut files = Vec::new();
        for (i, s) in steps.iter().enumerate() {
            if let Some(m) = &s.message {
                let p = work.path().join(format!("msg-{i}.txt"));
                std::fs::write(&p, m.trim_end().to_string() + "\n")?;
                files.push((i, sh_quote(&p)));
            }
        }
        let todo = build_todo(steps, |i| {
            files
                .iter()
                .find(|(j, _)| *j == i)
                .map(|(_, q)| q.clone())
                .unwrap_or_default()
        })?;
        let todo_path = work.path().join("todo");
        std::fs::write(&todo_path, &todo)?;

        let backup = self
            .make_backup(&format!("before editing commits on {branch}"), false)
            .await?;
        let editor = format!("sequence.editor=cp {}", sh_quote(&todo_path));
        let mut args: Vec<String> = vec!["-c".into(), editor, "rebase".into(), "-i".into()];
        match base {
            Some(b) => args.push(v::revision(b)?.to_string()),
            None => args.push("--root".into()),
        }
        self.git.run(self.path, &args, RunOpts::default()).await?;
        Ok(backup)
    }

    /// Saves HEAD (and, with `with_wip`, uncommitted tracked changes) under refs/gitpilot/backups.
    pub async fn make_backup(&self, label: &str, with_wip: bool) -> AppResult<Backup> {
        let head = self.ro(&["rev-parse", "HEAD"]).await?.trim().to_string();
        let stamp = chrono_stamp();
        let name = format!("{BACKUP_NS}{stamp}");
        let msg = format!("GitPilot backup: {label}");
        self.rw(&["update-ref", "-m", &msg, &name, &head]).await?;
        let mut wip = None;
        if with_wip {
            let sha = self
                .ro(&["stash", "create", &msg])
                .await
                .unwrap_or_default();
            let sha = sha.trim();
            if !sha.is_empty() {
                let wname = format!("refs/gitpilot/wip/{stamp}");
                self.rw(&["update-ref", "-m", &msg, &wname, sha]).await?;
                wip = Some(sha.to_string());
            }
        }
        // Keep the human-readable label as a small blob next to the backup ref, for listing.
        let blob = self
            .git
            .run(
                self.path,
                ["hash-object", "-w", "--stdin"],
                RunOpts {
                    stdin: Some(label.as_bytes()),
                    ..RunOpts::default()
                },
            )
            .await?
            .text();
        self.rw(&[
            "update-ref",
            &format!("refs/gitpilot/labels/{stamp}"),
            blob.trim(),
        ])
        .await?;
        Ok(Backup {
            name,
            hash: head,
            subject: String::new(),
            time: 0,
            label: label.to_string(),
            wip,
        })
    }

    pub async fn backups(&self) -> AppResult<Vec<Backup>> {
        let raw = self
            .ro(&[
                "for-each-ref",
                "--sort=-refname",
                "--format=%(refname)%1f%(objectname)%1f%(subject)%1f%(committerdate:unix)",
                BACKUP_NS,
            ])
            .await?;
        let mut out = Vec::new();
        for line in raw.lines() {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 4 {
                continue;
            }
            let stamp = f[0].trim_start_matches(BACKUP_NS);
            let label = self
                .ro(&["cat-file", "blob", &format!("refs/gitpilot/labels/{stamp}")])
                .await
                .unwrap_or_default();
            let wip = self
                .ro(&[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/gitpilot/wip/{stamp}"),
                ])
                .await
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            out.push(Backup {
                name: f[0].into(),
                hash: f[1].into(),
                subject: f[2].into(),
                time: stamp.parse::<i64>().map(|ms| ms / 1000).unwrap_or(0),
                label: label.trim().to_string(),
                wip,
            });
        }
        Ok(out)
    }

    pub async fn backup_delete(&self, name: &str) -> AppResult<()> {
        let stamp = name
            .strip_prefix(BACKUP_NS)
            .filter(|s| s.chars().all(|c| c.is_ascii_digit()))
            .ok_or_else(|| AppError::invalid("That isn't a GitPilot backup."))?;
        self.rw(&["update-ref", "-d", name]).await?;
        let _ = self
            .rw(&["update-ref", "-d", &format!("refs/gitpilot/wip/{stamp}")])
            .await;
        let _ = self
            .rw(&["update-ref", "-d", &format!("refs/gitpilot/labels/{stamp}")])
            .await;
        Ok(())
    }

    /// Moves the current branch to `target`. A backup of the current position (and, for a hard
    /// reset, of uncommitted changes) is made first. Returns the backup.
    pub async fn reset_to(&self, target: &str, mode: ResetMode) -> AppResult<Backup> {
        let target = v::revision(target)?;
        let st = self.status().await?;
        if st.state != RepoState::Normal {
            return Err(AppError::invalid(
                "Finish or abort the merge, rebase or cherry-pick in progress first.",
            ));
        }
        let branch = st.branch.head.clone().unwrap_or_else(|| "HEAD".into());
        let backup = self
            .make_backup(
                &format!("before reset of {branch}"),
                mode == ResetMode::Hard,
            )
            .await?;
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.rw(&["reset", "-q", flag, target]).await?;
        Ok(backup)
    }

    /// Restores a backup: the branch goes back to it (hard) and saved uncommitted changes are
    /// re-applied. A new backup of the current state is made first, so this can be undone too.
    pub async fn backup_restore(&self, name: &str) -> AppResult<()> {
        let list = self.backups().await?;
        let b = list
            .into_iter()
            .find(|b| b.name == name)
            .ok_or_else(|| AppError::invalid("That backup no longer exists."))?;
        self.reset_to(&b.hash, ResetMode::Hard).await?;
        if let Some(w) = b.wip {
            self.rw(&["stash", "apply", &w]).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<< HEAD\nm2\n||||||| base\nbase\n=======\nt2\n>>>>>>> feature\nc\n";

    #[test]
    fn resolves_blocks() {
        let (t, left) = resolve_block(TEXT, 0, ConflictChoice::Current).unwrap();
        assert_eq!(left, 1);
        assert!(t.starts_with("a\nmine\nb\n<<<<<<<"));
        let (t2, left) = resolve_block(&t, 0, ConflictChoice::Incoming).unwrap();
        assert_eq!(left, 0);
        assert_eq!(t2, "a\nmine\nb\nt2\nc\n", "diff3 base section dropped");
        let (both, _) = resolve_block(TEXT, 1, ConflictChoice::Both).unwrap();
        assert!(both.contains("b\nm2\nt2\nc\n"));
        assert!(resolve_block(TEXT, 5, ConflictChoice::Both).is_none());
        // CRLF files keep their line endings.
        let crlf = TEXT.replace('\n', "\r\n");
        let (t, _) = resolve_block(&crlf, 0, ConflictChoice::Incoming).unwrap();
        assert!(t.starts_with("a\r\ntheirs\r\nb\r\n"));
    }

    #[test]
    fn builds_todo() {
        let s = |h: &str, a, m: Option<&str>| RebaseStep {
            hash: h.into(),
            action: a,
            message: m.map(String::from),
        };
        let todo = build_todo(
            &[
                s("aaa", RebaseAction::Pick, None),
                s("bbb", RebaseAction::Squash, None),
                s("ccc", RebaseAction::Reword, Some("New")),
                s("ddd", RebaseAction::Drop, None),
            ],
            |i| format!("'/tmp/m{i}'"),
        )
        .unwrap();
        assert_eq!(
            todo,
            "pick aaa\nsquash bbb\npick ccc\nexec git commit --amend --only --no-verify --allow-empty -F '/tmp/m2'\ndrop ddd\n"
        );
        assert!(build_todo(&[s("a", RebaseAction::Fixup, None)], |_| String::new()).is_err());
        assert!(build_todo(&[s("a", RebaseAction::Drop, None)], |_| String::new()).is_err());
        assert!(build_todo(&[s("a", RebaseAction::Reword, None)], |_| String::new()).is_err());
        assert!(
            build_todo(
                &[
                    s("x", RebaseAction::Drop, None),
                    s("a", RebaseAction::Squash, None)
                ],
                |_| String::new()
            )
            .is_err(),
            "squash needs a kept commit before it"
        );
    }

    #[test]
    fn quotes_for_shell() {
        let q = sh_quote(std::path::Path::new("/tmp/it's here/todo"));
        assert_eq!(q, "'/tmp/it'\\''s here/todo'");
    }
}
