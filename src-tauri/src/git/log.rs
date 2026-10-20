//! Commit history: `git log` with a delimiter-based format.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::status::ChangeType;

/// Unit/record separators keep parsing unambiguous for any commit subject.
pub const LOG_FORMAT: &str =
    "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s%x1e";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    #[ts(type = "number")]
    pub author_time: i64,
    pub committer_name: String,
    pub committer_email: String,
    #[ts(type = "number")]
    pub commit_time: i64,
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub change: ChangeType,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitDetail {
    pub summary: CommitSummary,
    /// Full raw message (subject + body).
    pub message: String,
    pub files: Vec<CommitFile>,
    /// For merge commits, files are compared against the first parent.
    pub compared_to_first_parent: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogQuery {
    /// Branch/ref to list; defaults to HEAD.
    pub rev: Option<String>,
    pub skip: u32,
    pub limit: u32,
    /// Free-text search. `author:<name>` searches authors; a hex string also matches hashes.
    pub search: Option<String>,
    /// Limit history to one file (follows renames).
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogPage {
    pub commits: Vec<CommitSummary>,
    pub has_more: bool,
}

pub fn parse_log(raw: &str) -> Vec<CommitSummary> {
    raw.split('\x1e')
        .map(|r| r.trim_start_matches('\n'))
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.split('\x1f').collect();
            if f.len() < 11 {
                return None;
            }
            Some(CommitSummary {
                hash: f[0].into(),
                short_hash: f[1].into(),
                parents: f[2]
                    .split(' ')
                    .filter(|p| !p.is_empty())
                    .map(String::from)
                    .collect(),
                author_name: f[3].into(),
                author_email: f[4].into(),
                author_time: f[5].parse().unwrap_or(0),
                committer_name: f[6].into(),
                committer_email: f[7].into(),
                commit_time: f[8].parse().unwrap_or(0),
                refs: f[9]
                    .split(", ")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.trim_start_matches("HEAD -> ").to_string())
                    .collect(),
                subject: f[10].trim_end_matches('\n').into(),
            })
        })
        .collect()
}

/// Combines `--name-status -z` and `--numstat -z` output into file entries.
pub fn parse_commit_files(name_status: &[u8], numstat: &[u8]) -> Vec<CommitFile> {
    let ns = String::from_utf8_lossy(name_status);
    let mut tokens = ns.split('\0').filter(|t| !t.is_empty());
    let mut files = Vec::new();
    while let Some(code) = tokens.next() {
        let c = code.as_bytes()[0];
        let change = match c {
            b'A' => ChangeType::Added,
            b'D' => ChangeType::Deleted,
            b'R' => ChangeType::Renamed,
            b'C' => ChangeType::Copied,
            b'T' => ChangeType::TypeChanged,
            b'U' => ChangeType::Conflicted,
            _ => ChangeType::Modified,
        };
        let (orig, path) = if c == b'R' || c == b'C' {
            let o = tokens.next().unwrap_or_default().to_string();
            let p = tokens.next().unwrap_or_default().to_string();
            (Some(o), p)
        } else {
            (None, tokens.next().unwrap_or_default().to_string())
        };
        files.push(CommitFile {
            path,
            orig_path: orig,
            change,
            additions: None,
            deletions: None,
            binary: false,
        });
    }

    // numstat -z: "add\tdel\tpath\0" or for renames "add\tdel\t\0old\0new\0"
    let nm = String::from_utf8_lossy(numstat);
    let mut t = nm.split('\0');
    while let Some(rec) = t.next() {
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(3, '\t');
        let (a, d, p) = (parts.next(), parts.next(), parts.next());
        let path = match p {
            Some("") => {
                let _old = t.next();
                t.next().unwrap_or_default().to_string()
            }
            Some(p) => p.to_string(),
            None => continue,
        };
        if let Some(f) = files.iter_mut().find(|f| f.path == path) {
            if a == Some("-") {
                f.binary = true;
            } else {
                f.additions = a.and_then(|v| v.parse().ok());
                f.deletions = d.and_then(|v| v.parse().ok());
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let raw = "aaaa\x1faa\x1fp1 p2\x1fAnn\x1fa@x\x1f100\x1fCal\x1fc@x\x1f200\x1fHEAD -> main, origin/main\x1fMerge: thing | with pipes\x1e\n\
bbbb\x1fbb\x1f\x1fAnn\x1fa@x\x1f50\x1fAnn\x1fa@x\x1f50\x1f\x1froot\x1e";
        let c = parse_log(raw);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].parents.len(), 2);
        assert_eq!(c[0].refs, vec!["main", "origin/main"]);
        assert_eq!(c[0].committer_name, "Cal");
        assert!(c[1].parents.is_empty());
        assert!(c[1].refs.is_empty());
    }

    #[test]
    fn parses_files_with_rename() {
        let ns = b"M\0src/a.rs\0R087\0old.txt\0new.txt\0A\0img.png\0";
        let num = b"3\t1\tsrc/a.rs\0" as &[u8];
        let num = [num, b"1\t1\t\0old.txt\0new.txt\0-\t-\timg.png\0"].concat();
        let f = parse_commit_files(ns, &num);
        assert_eq!(f.len(), 3);
        assert_eq!(f[0].additions, Some(3));
        assert_eq!(f[1].orig_path.as_deref(), Some("old.txt"));
        assert_eq!(f[1].additions, Some(1));
        assert!(f[2].binary);
    }
}
