//! Parser for `git status --porcelain=v2 --branch -z`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Area {
    Staged,
    Unstaged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub area: Area,
    pub change: ChangeType,
    /// Human description for conflicts, e.g. "both modified".
    pub conflict: Option<String>,
    pub submodule: bool,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchInfo {
    /// Branch name; `None` when HEAD is detached.
    pub head: Option<String>,
    /// Commit id of HEAD; `None` in a repository with no commits yet.
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub detached: bool,
    pub unborn: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedStatus {
    pub branch: BranchInfo,
    pub files: Vec<FileEntry>,
}

fn change_from(c: u8) -> Option<ChangeType> {
    Some(match c {
        b'M' => ChangeType::Modified,
        b'A' => ChangeType::Added,
        b'D' => ChangeType::Deleted,
        b'R' => ChangeType::Renamed,
        b'C' => ChangeType::Copied,
        b'T' => ChangeType::TypeChanged,
        _ => return None,
    })
}

fn conflict_desc(xy: &str) -> &'static str {
    match xy {
        "DD" => "both deleted",
        "AU" => "added by us",
        "UD" => "deleted by them",
        "UA" => "added by them",
        "DU" => "deleted by us",
        "AA" => "both added",
        "UU" => "both modified",
        _ => "conflicted",
    }
}

pub fn parse(raw: &[u8]) -> ParsedStatus {
    let text = String::from_utf8_lossy(raw);
    let mut records = text.split('\0').filter(|r| !r.is_empty()).peekable();
    let mut out = ParsedStatus::default();

    while let Some(rec) = records.next() {
        if let Some(header) = rec.strip_prefix("# ") {
            parse_header(header, &mut out.branch);
            continue;
        }
        let kind = rec.as_bytes()[0];
        match kind {
            b'1' | b'2' => {
                // 1 XY sub mH mI mW hH hI path
                // 2 XY sub mH mI mW hH hI Xscore path  (then NUL origPath)
                let fields = if kind == b'1' { 9 } else { 10 };
                let parts: Vec<&str> = rec.splitn(fields, ' ').collect();
                if parts.len() < fields {
                    continue;
                }
                let xy = parts[1].as_bytes();
                let submodule = parts[2].starts_with('S');
                let path = parts[fields - 1].to_string();
                let orig = if kind == b'2' {
                    records.next().map(str::to_string)
                } else {
                    None
                };
                if let Some(c) = xy.first().copied().and_then(change_from) {
                    out.files.push(FileEntry {
                        path: path.clone(),
                        orig_path: orig.clone(),
                        area: Area::Staged,
                        change: c,
                        conflict: None,
                        submodule,
                    });
                }
                if let Some(c) = xy.get(1).copied().and_then(change_from) {
                    out.files.push(FileEntry {
                        path,
                        // A rename is an index-side concept; the worktree side refers to the new path.
                        orig_path: None,
                        area: Area::Unstaged,
                        change: c,
                        conflict: None,
                        submodule,
                    });
                }
            }
            b'u' => {
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let parts: Vec<&str> = rec.splitn(11, ' ').collect();
                if parts.len() < 11 {
                    continue;
                }
                out.files.push(FileEntry {
                    path: parts[10].to_string(),
                    orig_path: None,
                    area: Area::Conflicted,
                    change: ChangeType::Conflicted,
                    conflict: Some(conflict_desc(parts[1]).to_string()),
                    submodule: parts[2].starts_with('S'),
                });
            }
            b'?' => {
                if let Some(p) = rec.get(2..) {
                    out.files.push(FileEntry {
                        path: p.to_string(),
                        orig_path: None,
                        area: Area::Untracked,
                        change: ChangeType::Untracked,
                        conflict: None,
                        submodule: false,
                    });
                }
            }
            _ => {} // '!' ignored entries are not requested
        }
    }
    out
}

fn parse_header(h: &str, b: &mut BranchInfo) {
    if let Some(v) = h.strip_prefix("branch.oid ") {
        if v == "(initial)" {
            b.unborn = true;
        } else {
            b.oid = Some(v.to_string());
        }
    } else if let Some(v) = h.strip_prefix("branch.head ") {
        if v == "(detached)" {
            b.detached = true;
        } else {
            b.head = Some(v.to_string());
        }
    } else if let Some(v) = h.strip_prefix("branch.upstream ") {
        b.upstream = Some(v.to_string());
    } else if let Some(v) = h.strip_prefix("branch.ab ") {
        let mut it = v.split(' ');
        b.ahead = it
            .next()
            .and_then(|a| a.trim_start_matches('+').parse().ok());
        b.behind = it
            .next()
            .and_then(|a| a.trim_start_matches('-').parse().ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_record_types() {
        let raw = b"# branch.oid 1234abcd\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 MM N... 100644 100644 100644 aaaa bbbb src/app file.rs\0\
2 R. N... 100644 100644 100644 aaaa aaaa R100 new name.txt\0old name.txt\0\
u UU N... 100644 100644 100644 100644 a b c conflict.txt\0\
? untracked dir/x.md\0";
        let s = parse(raw);
        assert_eq!(s.branch.head.as_deref(), Some("main"));
        assert_eq!(s.branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.branch.ahead, s.branch.behind), (Some(2), Some(1)));
        assert_eq!(s.files.len(), 5);
        assert_eq!(s.files[0].path, "src/app file.rs");
        assert_eq!(s.files[0].area, Area::Staged);
        assert_eq!(s.files[1].area, Area::Unstaged);
        assert_eq!(s.files[2].change, ChangeType::Renamed);
        assert_eq!(s.files[2].orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(s.files[3].conflict.as_deref(), Some("both modified"));
        assert_eq!(s.files[4].path, "untracked dir/x.md");
    }

    #[test]
    fn parses_unborn_and_detached() {
        let s = parse(b"# branch.oid (initial)\0# branch.head main\0");
        assert!(s.branch.unborn);
        let s = parse(b"# branch.oid abc\0# branch.head (detached)\0");
        assert!(s.branch.detached);
        assert!(s.branch.head.is_none());
    }
}
