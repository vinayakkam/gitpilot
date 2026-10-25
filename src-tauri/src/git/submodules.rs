//! Submodules: listing them with their state, and downloading or updating them.

use serde::Serialize;
use tokio::sync::Notify;
use ts_rs::TS;

use super::redact::redact_text;
use super::repo::{Repo, NO_EXT};
use super::runner::{RunOpts, NETWORK_TIMEOUT};
use super::validate as v;
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SubmoduleState {
    /// Checked out at the commit this repository records.
    UpToDate,
    /// Not downloaded yet (`git submodule update --init` needed).
    NotInitialized,
    /// A different commit is checked out than the one recorded.
    DifferentCommit,
    /// The recorded commit has merge conflicts.
    Conflict,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Submodule {
    /// Path relative to the repository root.
    pub path: String,
    /// Name in .gitmodules (top-level submodules only).
    pub name: Option<String>,
    /// Redacted.
    pub url: Option<String>,
    pub branch: Option<String>,
    /// The commit checked out (or recorded, when not initialized).
    pub commit: String,
    /// `git describe` of that commit, when Git shows one.
    pub describe: Option<String>,
    pub state: SubmoduleState,
}

/// Parses `git submodule status --recursive`: `<state><sha> <path>[ (<describe>)]`.
pub fn parse_status(raw: &str) -> Vec<Submodule> {
    raw.lines()
        .filter_map(|line| {
            let mut chars = line.chars();
            let state = match chars.next()? {
                ' ' => SubmoduleState::UpToDate,
                '-' => SubmoduleState::NotInitialized,
                '+' => SubmoduleState::DifferentCommit,
                'U' => SubmoduleState::Conflict,
                _ => return None,
            };
            let rest = chars.as_str();
            let (commit, after) = rest.split_once(' ')?;
            let (path, describe) = match after.strip_suffix(')').and_then(|a| a.rsplit_once(" (")) {
                Some((p, d)) => (p, Some(d.to_string())),
                None => (after, None),
            };
            Some(Submodule {
                path: path.to_string(),
                name: None,
                url: None,
                branch: None,
                commit: commit.to_string(),
                describe,
                state,
            })
        })
        .collect()
}

/// `submodule.<name>.<key> value` lines from `.gitmodules` as (name, key, value).
pub fn parse_gitmodules(raw: &str) -> Vec<(String, String, String)> {
    raw.lines()
        .filter_map(|l| {
            let (k, value) = l.split_once(' ')?;
            let rest = k.strip_prefix("submodule.")?;
            let (name, key) = rest.rsplit_once('.')?;
            Some((name.to_string(), key.to_string(), value.to_string()))
        })
        .collect()
}

impl Repo<'_> {
    pub async fn submodules(&self) -> AppResult<Vec<Submodule>> {
        if !self.path.join(".gitmodules").is_file() {
            return Ok(Vec::new());
        }
        let status = self
            .git
            .read(self.path, ["submodule", "status", "--recursive"])
            .await?;
        let mut list = parse_status(&status);
        let config = self
            .git
            .run(
                self.path,
                [
                    "config",
                    "-f",
                    ".gitmodules",
                    "--get-regexp",
                    r"^submodule\..*\.(path|url|branch)$",
                ],
                RunOpts {
                    ok_codes: &[1],
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await?
            .text();
        let entries = parse_gitmodules(&config);
        for s in &mut list {
            let Some((name, _, _)) = entries
                .iter()
                .find(|(_, k, val)| k == "path" && *val == s.path)
            else {
                continue;
            };
            let get = |key: &str| {
                entries
                    .iter()
                    .find(|(n, k, _)| n == name && k == key)
                    .map(|(_, _, val)| val.clone())
            };
            s.url = get("url").map(|u| redact_text(&u));
            s.branch = get("branch");
            s.name = Some(name.clone());
        }
        Ok(list)
    }

    /// Downloads (if needed) and checks out the recorded commit of `paths` (all when empty),
    /// including nested submodules.
    pub async fn submodule_update<F: FnMut(String) + Send>(
        &self,
        paths: &[String],
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<()> {
        // Empty = every submodule; otherwise each path is validated.
        let paths = if paths.is_empty() {
            Vec::new()
        } else {
            v::rel_paths(paths)?
        };
        let mut args: Vec<&str> = NO_EXT.to_vec();
        args.extend([
            "submodule",
            "update",
            "--init",
            "--recursive",
            "--progress",
            "--",
        ]);
        args.extend(paths);
        self.git
            .run_streaming(self.path, &args, NETWORK_TIMEOUT, cancel, on)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_submodule_status() {
        let raw = " 1111111111111111111111111111111111111111 lib/core (v1.2.0)\n\
-2222222222222222222222222222222222222222 vendor/ui kit\n\
+3333333333333333333333333333333333333333 lib/core/nested (heads/main)\n\
U4444444444444444444444444444444444444444 docs\n\
garbage\n";
        let s = parse_status(raw);
        assert_eq!(s.len(), 4);
        assert_eq!(
            (s[0].path.as_str(), s[0].state),
            ("lib/core", SubmoduleState::UpToDate)
        );
        assert_eq!(s[0].describe.as_deref(), Some("v1.2.0"));
        assert_eq!(
            (s[1].path.as_str(), s[1].state),
            ("vendor/ui kit", SubmoduleState::NotInitialized)
        );
        assert_eq!(s[1].describe, None);
        assert_eq!(s[2].state, SubmoduleState::DifferentCommit);
        assert_eq!(s[3].state, SubmoduleState::Conflict);
    }

    #[test]
    fn parses_gitmodules_entries() {
        let e = parse_gitmodules(
            "submodule.lib.core.path lib/core\nsubmodule.lib.core.url https://example.com/core.git\nsubmodule.ui.branch main\n",
        );
        assert_eq!(
            e,
            vec![
                ("lib.core".into(), "path".into(), "lib/core".into()),
                (
                    "lib.core".into(),
                    "url".into(),
                    "https://example.com/core.git".into()
                ),
                ("ui".into(), "branch".into(), "main".into()),
            ]
        );
    }
}
