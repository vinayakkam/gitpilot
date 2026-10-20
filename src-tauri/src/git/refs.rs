//! Branches, remotes and stashes: types and parsers.

use serde::Serialize;
use ts_rs::TS;

use super::redact::{has_credentials, redact_text};

pub const BRANCH_FORMAT: &str = "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(committerdate:unix)%1f%(contents:subject)%1e";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Branch {
    pub name: String,
    pub full_ref: String,
    pub is_remote: bool,
    /// For remote-tracking branches: the remote name (e.g. "origin").
    pub remote: Option<String>,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// The configured upstream no longer exists on the remote.
    pub upstream_gone: bool,
    pub tip: String,
    #[ts(type = "number")]
    pub last_commit_time: i64,
    pub subject: String,
    /// Merged into the current HEAD (local branches only; `None` if unknown).
    pub merged: Option<bool>,
}

pub fn parse_branches(raw: &str, remotes: &[String]) -> Vec<Branch> {
    raw.split('\x1e')
        .map(|r| r.trim_start_matches('\n'))
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.split('\x1f').collect();
            if f.len() < 8 {
                return None;
            }
            let full = f[0];
            let is_remote = full.starts_with("refs/remotes/");
            if is_remote && full.ends_with("/HEAD") {
                return None;
            }
            let short = f[1].to_string();
            let remote = if is_remote {
                let rest = full.trim_start_matches("refs/remotes/");
                // Prefer the longest configured remote name that prefixes the ref.
                remotes
                    .iter()
                    .filter(|n| rest.starts_with(&format!("{n}/")))
                    .max_by_key(|n| n.len())
                    .cloned()
                    .or_else(|| rest.split('/').next().map(String::from))
            } else {
                None
            };
            let track = f[4];
            let mut ahead = None;
            let mut behind = None;
            for part in track.split(", ") {
                if let Some(v) = part.strip_prefix("ahead ") {
                    ahead = v.parse().ok();
                } else if let Some(v) = part.strip_prefix("behind ") {
                    behind = v.parse().ok();
                }
            }
            let has_upstream = !f[3].is_empty();
            Some(Branch {
                name: short,
                full_ref: full.to_string(),
                is_remote,
                remote,
                is_current: f[5] == "*",
                upstream: has_upstream.then(|| f[3].to_string()),
                ahead: if has_upstream && track != "gone" {
                    Some(ahead.unwrap_or(0))
                } else {
                    None
                },
                behind: if has_upstream && track != "gone" {
                    Some(behind.unwrap_or(0))
                } else {
                    None
                },
                upstream_gone: track == "gone",
                tip: f[2].to_string(),
                last_commit_time: f[6].parse().unwrap_or(0),
                subject: f[7].trim_end_matches('\n').to_string(),
                merged: None,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Remote {
    pub name: String,
    /// Redacted for display.
    pub fetch_url: String,
    pub push_url: String,
    /// The configured URL contains an embedded credential (it is never shown).
    pub has_credentials: bool,
}

pub fn parse_remotes(raw: &str) -> Vec<Remote> {
    let mut out: Vec<Remote> = Vec::new();
    for line in raw.lines() {
        let Some((name, rest)) = line.split_once('\t') else {
            continue;
        };
        let (url, kind) = match rest.rsplit_once(' ') {
            Some((u, k)) => (u, k),
            None => (rest, "(fetch)"),
        };
        let creds = has_credentials(url);
        let shown = redact_text(url);
        let entry = match out.iter_mut().find(|r| r.name == name) {
            Some(e) => e,
            None => {
                out.push(Remote {
                    name: name.to_string(),
                    fetch_url: String::new(),
                    push_url: String::new(),
                    has_credentials: false,
                });
                out.last_mut().expect("just pushed")
            }
        };
        entry.has_credentials |= creds;
        if kind == "(push)" {
            entry.push_url = shown;
        } else {
            entry.fetch_url = shown;
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Stash {
    pub index: u32,
    pub reference: String,
    pub message: String,
    #[ts(type = "number")]
    pub time: i64,
}

pub fn parse_stashes(raw: &str) -> Vec<Stash> {
    raw.split('\x1e')
        .map(|r| r.trim_start_matches('\n'))
        .filter(|r| !r.is_empty())
        .enumerate()
        .filter_map(|(i, r)| {
            let mut f = r.split('\x1f');
            Some(Stash {
                index: i as u32,
                reference: f.next()?.to_string(),
                time: f.next()?.parse().unwrap_or(0),
                message: f.next().unwrap_or("").trim_end().to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branches() {
        let raw = "refs/heads/main\x1fmain\x1fabc\x1forigin/main\x1fahead 2, behind 1\x1f*\x1f100\x1fsubj\x1e\n\
refs/heads/old\x1fold\x1fdef\x1forigin/old\x1fgone\x1f \x1f90\x1fx\x1e\n\
refs/remotes/origin/HEAD\x1forigin\x1fabc\x1f\x1f\x1f \x1f100\x1fsubj\x1e\n\
refs/remotes/my/fork/feat\x1fmy/fork/feat\x1fabc\x1f\x1f\x1f \x1f100\x1fsubj\x1e";
        let b = parse_branches(raw, &["origin".into(), "my/fork".into()]);
        assert_eq!(b.len(), 3);
        assert!(b[0].is_current);
        assert_eq!((b[0].ahead, b[0].behind), (Some(2), Some(1)));
        assert!(b[1].upstream_gone);
        assert_eq!(b[2].remote.as_deref(), Some("my/fork"));
    }

    #[test]
    fn parses_remotes_redacted() {
        let raw = "origin\thttps://u:tok@h/r.git (fetch)\norigin\thttps://u:tok@h/r.git (push)\nup\tgit@h:o/r.git (fetch)\nup\tgit@h:o/r.git (push)\n";
        let r = parse_remotes(raw);
        assert_eq!(r.len(), 2);
        assert!(r[0].has_credentials);
        assert!(!r[0].fetch_url.contains("tok"));
        assert_eq!(r[1].push_url, "git@h:o/r.git");
    }
}
