//! The reflog: where HEAD pointed before, so lost commits can be found and brought back.

use std::collections::HashSet;

use serde::Serialize;
use ts_rs::TS;

use super::repo::Repo;
use super::runner::RunOpts;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReflogEntry {
    /// Position in the reflog: 0 = where HEAD is now (`HEAD@{0}`).
    pub index: u32,
    pub hash: String,
    /// What moved HEAD: "commit", "checkout", "reset", "rebase (finish)", "pull", …
    pub action: String,
    /// The rest of git's description, e.g. "moving from main to feature".
    pub message: String,
    /// Subject of the commit HEAD pointed to.
    pub subject: String,
    /// When HEAD moved (unix seconds).
    #[ts(type = "number")]
    pub time: i64,
    /// The commit isn't on any branch, tag or remote branch any more: only the reflog keeps it.
    pub lost: bool,
}

const FORMAT: &str = "--format=%H%x1f%gd%x1f%gs%x1f%s%x1e";

/// Parses `git log -g --date=unix` output in `FORMAT`; `lost` is filled in later.
pub fn parse(raw: &str) -> Vec<ReflogEntry> {
    raw.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            let mut f = rec.split('\x1f');
            let hash = f.next()?.to_string();
            let selector = f.next()?;
            let what = f.next()?;
            let subject = f.next().unwrap_or("").trim_end().to_string();
            // HEAD@{1730000000}
            let time = selector
                .rsplit_once("@{")
                .and_then(|(_, t)| t.strip_suffix('}'))
                .and_then(|t| t.parse().ok())?;
            let (action, message) = match what.split_once(": ") {
                Some((a, m)) => (a.to_string(), m.to_string()),
                None => (what.to_string(), String::new()),
            };
            Some(ReflogEntry {
                index: 0,
                hash,
                action,
                message,
                subject,
                time,
                lost: false,
            })
        })
        .enumerate()
        .map(|(i, mut e)| {
            e.index = i as u32;
            e
        })
        .collect()
}

impl Repo<'_> {
    /// The newest `limit` positions of HEAD, newest first. Empty for a repository with no commits.
    pub async fn reflog(&self, limit: u32) -> AppResult<Vec<ReflogEntry>> {
        let exists = self
            .git
            .run(
                self.path,
                ["reflog", "exists", "HEAD"],
                RunOpts {
                    ok_codes: &[1],
                    ..RunOpts::read()
                },
            )
            .await?;
        if exists.code != 0 {
            return Ok(Vec::new());
        }
        let n = format!("-n{}", limit.clamp(1, 1000));
        let raw = self
            .git
            .read(self.path, ["log", "-g", "--date=unix", FORMAT, &n, "HEAD"])
            .await?;
        let mut entries = parse(&raw);
        let lost = self.unreachable(&entries).await?;
        for e in &mut entries {
            e.lost = lost.contains(&e.hash);
        }
        Ok(entries)
    }

    /// Which of the entries' commits no branch, tag or remote branch contains.
    async fn unreachable(&self, entries: &[ReflogEntry]) -> AppResult<HashSet<String>> {
        let wanted: HashSet<&str> = entries.iter().map(|e| e.hash.as_str()).collect();
        if wanted.is_empty() {
            return Ok(HashSet::new());
        }
        // Walks only the commits outside every ref, so it stays cheap on big repositories.
        let mut args = vec!["rev-list"];
        args.extend(wanted.iter().copied());
        args.extend(["--not", "--branches", "--tags", "--remotes"]);
        let out = self.git.read(self.path, &args).await?;
        Ok(out
            .lines()
            .filter(|h| wanted.contains(h))
            .map(str::to_string)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entries() {
        let raw = "aaa\x1fHEAD@{1700000100}\x1freset: moving to HEAD~1\x1fFirst\x1e\nbbb\x1fHEAD@{1700000000}\x1fcommit (initial): Second\x1fSecond\n\x1e\nccc\x1fHEAD@{1699999999}\x1fodd\x1f\x1e\n";
        let e = parse(raw);
        assert_eq!(e.len(), 3);
        assert_eq!(e[0].index, 0);
        assert_eq!(e[0].hash, "aaa");
        assert_eq!(e[0].action, "reset");
        assert_eq!(e[0].message, "moving to HEAD~1");
        assert_eq!(e[0].time, 1700000100);
        assert_eq!(e[1].action, "commit (initial)");
        assert_eq!(e[1].subject, "Second");
        assert_eq!(e[2].index, 2);
        assert_eq!(e[2].action, "odd");
        assert_eq!(e[2].message, "");
    }

    #[test]
    fn skips_records_without_a_time() {
        assert!(parse("aaa\x1fHEAD@{0}x\x1fcommit: a\x1fa\x1e").is_empty());
        assert!(parse("").is_empty());
    }
}
