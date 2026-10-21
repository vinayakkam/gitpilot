//! Line-ending guard.
//!
//! When a file is committed with Windows line endings (CRLF) into a repository that stores
//! LF, every line of that file changes. GitHub then shows the whole file as rewritten, and
//! pull-request suggestions and patches fail with "context doesn't match". This module finds
//! staged files that would do that and can rewrite them with LF before the commit happens.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::repo::Repo;
use super::runner::RunOpts;
use super::validate as v;
use crate::error::{AppError, AppResult};

/// Files larger than this are not inspected (they are almost never hand-edited text).
const MAX_BLOB: usize = 4 * 1024 * 1024;
/// At most this many staged files are inspected per check.
const MAX_FILES: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EolKind {
    /// Nothing but line endings changed: every line will show as modified.
    LineEndingsOnly,
    /// Real changes, but the file also switched to CRLF (or a new file uses CRLF in an LF repository).
    CrlfIntroduced,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EolIssue {
    pub path: String,
    pub kind: EolKind,
    /// Lines in the staged version that end in CRLF.
    pub crlf_lines: u32,
    pub new_file: bool,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EolReport {
    pub issues: Vec<EolIssue>,
    /// A `text` attribute (e.g. `* text=auto` in .gitattributes) applies, so Git normalizes on add.
    pub has_text_rule: bool,
    /// Value of core.autocrlf, if set.
    pub autocrlf: Option<String>,
}

/// (lines ending in CRLF, lines ending in a bare LF)
pub fn count_eol(data: &[u8]) -> (u32, u32) {
    let mut crlf = 0;
    let mut lf = 0;
    for (i, b) in data.iter().enumerate() {
        if *b == b'\n' {
            if i > 0 && data[i - 1] == b'\r' {
                crlf += 1;
            } else {
                lf += 1;
            }
        }
    }
    (crlf, lf)
}

pub fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(8000)].contains(&0)
}

/// Replaces every CRLF with LF. Lone CRs are kept.
pub fn normalize(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        if data[i] == b'\r' && data.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(data[i]);
        i += 1;
    }
    out
}

/// Decides whether committing `staged` (replacing `head`, or adding a new file when `head` is
/// None) would introduce CRLF line endings. `repo_lf` says whether the repository stores LF.
pub fn classify(head: Option<&[u8]>, staged: &[u8], repo_lf: bool) -> Option<EolKind> {
    if is_binary(staged) {
        return None;
    }
    let (crlf, _) = count_eol(staged);
    if crlf == 0 {
        return None;
    }
    match head {
        Some(old) => {
            if is_binary(old) || count_eol(old).0 > 0 {
                // The committed file already had CRLF lines; this commit doesn't make it worse.
                return None;
            }
            if normalize(staged) == old {
                Some(EolKind::LineEndingsOnly)
            } else {
                Some(EolKind::CrlfIntroduced)
            }
        }
        None => repo_lf.then_some(EolKind::CrlfIntroduced),
    }
}

/// Parses `git check-attr -z` output (path NUL attr NUL value NUL ...).
fn parse_check_attr(out: &[u8]) -> Vec<(String, String, String)> {
    let parts: Vec<String> = out
        .split(|b| *b == 0)
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();
    parts
        .chunks(3)
        .filter(|c| c.len() == 3 && !c[0].is_empty())
        .map(|c| (c[0].clone(), c[1].clone(), c[2].clone()))
        .collect()
}

impl Repo<'_> {
    async fn eol_blob(&self, spec: &str) -> Option<Vec<u8>> {
        let out = self
            .git
            .run(self.path, ["cat-file", "blob", spec], RunOpts::read())
            .await
            .ok()?;
        Some(out.stdout)
    }

    async fn eol_staged_paths(&self) -> AppResult<Vec<String>> {
        let out = self
            .git
            .run(
                self.path,
                [
                    "diff",
                    "--cached",
                    "--name-only",
                    "-z",
                    "--no-renames",
                    "--diff-filter=AM",
                ],
                RunOpts::read(),
            )
            .await?;
        Ok(out
            .stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect())
    }

    /// True when most tracked files outside `exclude` use LF (or nothing is tracked yet).
    async fn eol_repo_uses_lf(&self, exclude: &HashSet<&str>) -> bool {
        let Ok(out) = self
            .git
            .run(self.path, ["ls-files", "--eol", "-z"], RunOpts::read())
            .await
        else {
            return true;
        };
        let (mut lf, mut crlf) = (0u32, 0u32);
        for rec in out.stdout.split(|b| *b == 0).filter(|s| !s.is_empty()) {
            let rec = String::from_utf8_lossy(rec);
            let Some((info, path)) = rec.split_once('\t') else {
                continue;
            };
            if exclude.contains(path) {
                continue;
            }
            match info.split_whitespace().next() {
                Some("i/lf") => lf += 1,
                Some("i/crlf") | Some("i/mixed") => crlf += 1,
                _ => {}
            }
        }
        lf >= crlf
    }

    pub async fn eol_check(&self) -> AppResult<EolReport> {
        let mut paths = self.eol_staged_paths().await?;
        paths.truncate(MAX_FILES);
        let autocrlf = self
            .git
            .run(
                self.path,
                ["config", "--get", "core.autocrlf"],
                RunOpts {
                    ok_codes: &[1],
                    ..RunOpts::read()
                },
            )
            .await
            .map(|o| o.text().trim().to_string())
            .ok()
            .filter(|s| !s.is_empty());
        if paths.is_empty() {
            return Ok(EolReport {
                autocrlf,
                ..EolReport::default()
            });
        }

        // Attributes: files marked -text/binary or eol=crlf are meant to keep CRLF.
        let mut args = vec!["check-attr", "-z", "text", "eol", "--"];
        args.extend(paths.iter().map(String::as_str));
        let attrs = self
            .git
            .run(self.path, &args, RunOpts::read())
            .await
            .map(|o| parse_check_attr(&o.stdout))
            .unwrap_or_default();
        let mut keep_crlf: HashSet<String> = HashSet::new();
        let mut has_text_rule = false;
        for (p, attr, value) in &attrs {
            match (attr.as_str(), value.as_str()) {
                ("text", "unset") | ("eol", "crlf") => {
                    keep_crlf.insert(p.clone());
                }
                ("text", "set") | ("text", "auto") => has_text_rule = true,
                _ => {}
            }
        }

        let exclude: HashSet<&str> = paths.iter().map(String::as_str).collect();
        let repo_lf = self.eol_repo_uses_lf(&exclude).await;

        let mut issues = Vec::new();
        for p in &paths {
            if keep_crlf.contains(p) {
                continue;
            }
            let Some(staged) = self.eol_blob(&format!(":{p}")).await else {
                continue;
            };
            if staged.len() > MAX_BLOB {
                continue;
            }
            let head = self.eol_blob(&format!("HEAD:{p}")).await;
            if let Some(kind) = classify(head.as_deref(), &staged, repo_lf) {
                issues.push(EolIssue {
                    path: p.clone(),
                    kind,
                    crlf_lines: count_eol(&staged).0,
                    new_file: head.is_none(),
                });
            }
        }
        Ok(EolReport {
            issues,
            has_text_rule,
            autocrlf,
        })
    }

    /// Rewrites the staged version of each file with LF line endings, and the working copy too
    /// (after backing it up to `backup_root/<timestamp>/`) so the fix doesn't reappear as an
    /// unstaged change. Returns the number of files changed.
    pub async fn eol_fix(&self, paths: &[String], backup_root: &Path) -> AppResult<u32> {
        let paths = v::rel_paths(paths)?;
        let stamp = super::repo::chrono_stamp();
        let mut fixed = 0;
        for p in paths {
            let Some(staged) = self.eol_blob(&format!(":{p}")).await else {
                return Err(AppError::invalid(format!("'{p}' isn't staged.")));
            };
            if is_binary(&staged) || count_eol(&staged).0 == 0 {
                continue;
            }
            // Mode of the index entry ("100644 <sha> 0\tpath").
            let ls = self
                .git
                .run(self.path, ["ls-files", "-s", "--", p], RunOpts::read())
                .await?
                .text();
            let mode = ls.split_whitespace().next().unwrap_or("100644").to_string();
            if !mode.starts_with("100") {
                continue;
            }
            let fixed_blob = normalize(&staged);
            let sha = self
                .git
                .run(
                    self.path,
                    ["hash-object", "-w", "--no-filters", "--stdin"],
                    RunOpts {
                        stdin: Some(&fixed_blob),
                        ..RunOpts::default()
                    },
                )
                .await?
                .text()
                .trim()
                .to_string();
            let info = format!("{mode},{sha},{p}");
            self.git
                .run(
                    self.path,
                    ["update-index", "--cacheinfo", &info],
                    RunOpts::default(),
                )
                .await?;

            let file = self.path.join(p);
            if let Ok(bytes) = std::fs::read(&file) {
                if !is_binary(&bytes) && count_eol(&bytes).0 > 0 {
                    let dst = backup_root.join(&stamp).join(p);
                    if let Some(parent) = dst.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::copy(&file, &dst)?;
                    std::fs::write(&file, normalize(&bytes))?;
                }
            }
            fixed += 1;
        }
        Ok(fixed)
    }

    /// Adds `* text=auto` to the top of .gitattributes (creating it if needed) so Git stores
    /// text files with LF from now on. Returns false if a catch-all text rule already exists.
    pub async fn eol_add_gitattributes(&self) -> AppResult<bool> {
        let file = self.path.join(".gitattributes");
        let existing = std::fs::read_to_string(&file).unwrap_or_default();
        let has_rule = existing.lines().any(|l| {
            let mut parts = l.split_whitespace();
            parts.next() == Some("*") && parts.any(|a| a.starts_with("text"))
        });
        if has_rule {
            return Ok(false);
        }
        // Prepended, not appended: later lines win in .gitattributes, and a trailing `*` rule
        // would override existing rules such as `*.png binary`.
        let rule = "# Store text files with LF line endings in the repository (added by GitPilot).\n* text=auto\n";
        let content = if existing.is_empty() {
            rule.to_string()
        } else {
            format!("{rule}\n{existing}")
        };
        std::fs::write(&file, content)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_normalizes() {
        assert_eq!(count_eol(b"a\r\nb\nc\r\n"), (2, 1));
        assert_eq!(normalize(b"a\r\nb\r\rc\n"), b"a\nb\r\rc\n");
        assert!(is_binary(b"\x00\x01"));
    }

    #[test]
    fn classifies() {
        let lf = b"one\ntwo\n";
        assert_eq!(
            classify(Some(lf), b"one\r\ntwo\r\n", true),
            Some(EolKind::LineEndingsOnly)
        );
        assert_eq!(
            classify(Some(lf), b"one\r\nthree\r\n", true),
            Some(EolKind::CrlfIntroduced)
        );
        // Already CRLF in HEAD: not this commit's fault.
        assert_eq!(classify(Some(b"x\r\n"), b"y\r\n", true), None);
        // New file: only flagged in LF repositories.
        assert_eq!(
            classify(None, b"x\r\n", true),
            Some(EolKind::CrlfIntroduced)
        );
        assert_eq!(classify(None, b"x\r\n", false), None);
        assert_eq!(classify(Some(lf), b"one\ntwo\nthree\n", true), None);
        assert_eq!(classify(Some(lf), b"\x00\r\n", true), None);
    }

    #[test]
    fn parses_check_attr() {
        let out = b"a.txt\0text\0auto\0a.txt\0eol\0unspecified\0b.bat\0eol\0crlf\0";
        let v = parse_check_attr(out);
        assert_eq!(v.len(), 3);
        assert_eq!(v[2], ("b.bat".into(), "eol".into(), "crlf".into()));
    }
}
