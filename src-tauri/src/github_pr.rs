//! Reviewing a pull request in GitPilot: its details, changed files, conversation and checks,
//! and the review, comment, merge and delete-branch actions (GitHub REST API).

use serde::Serialize;
use serde_json::{json, Value};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::diff::{self, FileDiff};
use crate::github::{api_req, client, get, send, valid_name};

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PullDetail {
    pub number: u32,
    pub title: String,
    /// Markdown.
    pub body: String,
    pub url: String,
    pub author: Option<String>,
    /// "open", "closed" or "merged".
    pub state: String,
    pub draft: bool,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub cross_repository: bool,
    /// GitHub's answer to "can this be merged without conflicts"; `None` while it's computing.
    pub mergeable: Option<bool>,
    /// "clean", "blocked", "behind", "dirty", "unstable", "draft", "unknown", …
    pub mergeable_state: String,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PullFile {
    pub path: String,
    pub previous_path: Option<String>,
    /// "added", "removed", "modified", "renamed", …
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    /// `None` when GitHub doesn't send a patch (binary or very large files).
    pub diff: Option<FileDiff>,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PullComment {
    /// "comment" (conversation), "review" (a submitted review) or "reviewComment" (on a line).
    pub kind: String,
    pub author: Option<String>,
    /// Markdown; empty for a review without a summary.
    pub body: String,
    /// ISO 8601.
    pub created_at: String,
    /// Reviews: "APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED".
    pub review_state: Option<String>,
    /// Review comments: the file and line they're on.
    pub path: Option<String>,
    pub line: Option<u32>,
    /// Review comments: "LEFT" (a removed line, old numbering) or "RIGHT" (new numbering).
    pub side: Option<String>,
    /// Review comments whose line is no longer in the diff (newer commits changed it).
    pub outdated: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckRun {
    pub name: String,
    /// "success", "failure", "pending", "neutral", "skipped", "cancelled", "timedOut", "actionRequired".
    pub result: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Copy, serde::Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReviewEvent {
    Comment,
    Approve,
    RequestChanges,
}

#[derive(Debug, Clone, Copy, serde::Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MergeMethod {
    Merge,
    Squash,
    Rebase,
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn n(v: &Value) -> u32 {
    v.as_u64().unwrap_or(0) as u32
}

fn login(v: &Value) -> Option<String> {
    v["login"].as_str().map(str::to_string)
}

fn base(owner: &str, name: &str, number: u32) -> AppResult<String> {
    Ok(format!(
        "/repos/{}/{}/pulls/{number}",
        valid_name(owner)?,
        valid_name(name)?
    ))
}

pub fn parse_detail(v: &Value) -> Option<PullDetail> {
    let state = if v["merged"].as_bool() == Some(true) || !v["merged_at"].is_null() {
        "merged".to_string()
    } else {
        s(&v["state"])
    };
    Some(PullDetail {
        number: v["number"].as_u64()? as u32,
        title: s(&v["title"]),
        body: s(&v["body"]),
        url: s(&v["html_url"]),
        author: login(&v["user"]),
        state,
        draft: v["draft"].as_bool().unwrap_or(false),
        head_ref: s(&v["head"]["ref"]),
        head_sha: s(&v["head"]["sha"]),
        base_ref: s(&v["base"]["ref"]),
        cross_repository: v["head"]["repo"]["full_name"] != v["base"]["repo"]["full_name"],
        mergeable: v["mergeable"].as_bool(),
        mergeable_state: v["mergeable_state"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        additions: n(&v["additions"]),
        deletions: n(&v["deletions"]),
        changed_files: n(&v["changed_files"]),
    })
}

/// GitHub's per-file patch with the git headers around it, so it reads like `git diff` output.
fn wrap_patch(path: &str, previous: Option<&str>, status: &str, patch: &str) -> String {
    let old = previous.unwrap_or(path);
    let (from, to) = match status {
        "added" => ("/dev/null".to_string(), format!("b/{path}")),
        "removed" => (format!("a/{old}"), "/dev/null".to_string()),
        _ => (format!("a/{old}"), format!("b/{path}")),
    };
    let mut raw = format!("diff --git a/{old} b/{path}\n");
    match status {
        "added" => raw.push_str("new file mode 100644\n"),
        "removed" => raw.push_str("deleted file mode 100644\n"),
        "renamed" => raw.push_str(&format!("rename from {old}\nrename to {path}\n")),
        _ => {}
    }
    raw.push_str(&format!("--- {from}\n+++ {to}\n{patch}\n"));
    raw
}

/// The whole pull request as one `git diff`-style text (for the AI explanation).
pub async fn diff_text(token: &str, owner: &str, name: &str, number: u32) -> AppResult<String> {
    let path = base(owner, name, number)?;
    let mut out = String::new();
    for page in 1..=30 {
        let v = get(token, &format!("{path}/files?per_page=100&page={page}")).await?;
        let batch = v.as_array().cloned().unwrap_or_default();
        for f in &batch {
            if let (Some(p), Some(patch)) = (f["filename"].as_str(), f["patch"].as_str()) {
                out.push_str(&wrap_patch(
                    p,
                    f["previous_filename"].as_str(),
                    f["status"].as_str().unwrap_or(""),
                    patch,
                ));
            }
        }
        if batch.len() < 100 {
            break;
        }
    }
    Ok(out)
}

/// A file from `pulls/{n}/files`; its patch is wrapped in git's headers so `diff::parse` reads it.
pub fn parse_file(v: &Value) -> Option<PullFile> {
    let path = v["filename"].as_str()?.to_string();
    let previous = v["previous_filename"].as_str().map(str::to_string);
    let status = s(&v["status"]);
    let diff = v["patch"].as_str().and_then(|patch| {
        let raw = wrap_patch(&path, previous.as_deref(), &status, patch);
        diff::parse(raw.as_bytes()).into_iter().next().map(|mut d| {
            // Lines can't be staged from GitHub's copy.
            d.hunk_actions = false;
            d
        })
    });
    Some(PullFile {
        path,
        previous_path: previous,
        status,
        additions: n(&v["additions"]),
        deletions: n(&v["deletions"]),
        diff,
    })
}

/// Conversation comments, reviews and line comments merged into one timeline, oldest first.
pub fn parse_conversation(
    comments: &Value,
    reviews: &Value,
    line_comments: &Value,
) -> Vec<PullComment> {
    let mut out: Vec<PullComment> = Vec::new();
    for c in comments.as_array().into_iter().flatten() {
        out.push(PullComment {
            kind: "comment".into(),
            author: login(&c["user"]),
            body: s(&c["body"]),
            created_at: s(&c["created_at"]),
            review_state: None,
            path: None,
            line: None,
            side: None,
            outdated: false,
            url: s(&c["html_url"]),
        });
    }
    for r in reviews.as_array().into_iter().flatten() {
        let state = s(&r["state"]);
        // A COMMENTED review with no summary only wraps line comments, which are listed anyway.
        if state == "PENDING" || (state == "COMMENTED" && s(&r["body"]).trim().is_empty()) {
            continue;
        }
        out.push(PullComment {
            kind: "review".into(),
            author: login(&r["user"]),
            body: s(&r["body"]),
            created_at: s(&r["submitted_at"]),
            review_state: Some(state),
            path: None,
            line: None,
            side: None,
            outdated: false,
            url: s(&r["html_url"]),
        });
    }
    for c in line_comments.as_array().into_iter().flatten() {
        out.push(PullComment {
            kind: "reviewComment".into(),
            author: login(&c["user"]),
            body: s(&c["body"]),
            created_at: s(&c["created_at"]),
            review_state: None,
            path: c["path"].as_str().map(str::to_string),
            line: c["line"]
                .as_u64()
                .or_else(|| c["original_line"].as_u64())
                .map(|l| l as u32),
            side: c["side"]
                .as_str()
                .or_else(|| c["original_side"].as_str())
                .map(str::to_string),
            outdated: c["line"].is_null(),
            url: s(&c["html_url"]),
        });
    }
    // ISO 8601 in UTC sorts as text.
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    out
}

/// Check runs (GitHub Actions and apps) and commit statuses (older CI integrations).
pub fn parse_checks(runs: &Value, statuses: &Value) -> Vec<CheckRun> {
    let mut out: Vec<CheckRun> = runs["check_runs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            let result = if r["status"].as_str() != Some("completed") {
                "pending".to_string()
            } else {
                match r["conclusion"].as_str().unwrap_or("") {
                    "timed_out" => "timedOut".to_string(),
                    "action_required" => "actionRequired".to_string(),
                    "" | "stale" => "neutral".to_string(),
                    c => c.to_string(),
                }
            };
            CheckRun {
                name: s(&r["name"]),
                result,
                url: r["html_url"]
                    .as_str()
                    .or_else(|| r["details_url"].as_str())
                    .map(str::to_string),
            }
        })
        .collect();
    for st in statuses["statuses"].as_array().into_iter().flatten() {
        out.push(CheckRun {
            name: s(&st["context"]),
            result: match st["state"].as_str().unwrap_or("") {
                "error" => "failure".to_string(),
                x => x.to_string(),
            },
            url: st["target_url"].as_str().map(str::to_string),
        });
    }
    out
}

pub async fn detail(token: &str, owner: &str, name: &str, number: u32) -> AppResult<PullDetail> {
    let v = get(token, &base(owner, name, number)?).await?;
    parse_detail(&v).ok_or_else(|| {
        AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unexpected response.",
        )
        .with_detail(v.to_string())
    })
}

/// Changed files (GitHub returns at most 3000), 100 per page.
pub async fn files(token: &str, owner: &str, name: &str, number: u32) -> AppResult<Vec<PullFile>> {
    let path = base(owner, name, number)?;
    let all = get_all(token, &format!("{path}/files"), 30).await?;
    Ok(all
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(parse_file)
        .collect())
}

/// Every item of a list endpoint, 100 per page, up to `max_pages` pages, as one JSON array.
async fn get_all(token: &str, path: &str, max_pages: u32) -> AppResult<Value> {
    let sep = if path.contains('?') { '&' } else { '?' };
    let mut out = Vec::new();
    for page in 1..=max_pages {
        let v = get(token, &format!("{path}{sep}per_page=100&page={page}")).await?;
        let batch = v.as_array().cloned().unwrap_or_default();
        let done = batch.len() < 100;
        out.extend(batch);
        if done {
            break;
        }
    }
    Ok(Value::Array(out))
}

pub async fn conversation(
    token: &str,
    owner: &str,
    name: &str,
    number: u32,
) -> AppResult<Vec<PullComment>> {
    let (o, r) = (valid_name(owner)?, valid_name(name)?);
    let path = base(owner, name, number)?;
    let (cp, rp, lp) = (
        format!("/repos/{o}/{r}/issues/{number}/comments"),
        format!("{path}/reviews"),
        format!("{path}/comments"),
    );
    // Up to 1000 of each; very long discussions are cut there (Open on GitHub shows the rest).
    let (c, rv, lc) = tokio::join!(
        get_all(token, &cp, 10),
        get_all(token, &rp, 10),
        get_all(token, &lp, 10)
    );
    Ok(parse_conversation(&c?, &rv?, &lc?))
}

pub async fn checks(token: &str, owner: &str, name: &str, sha: &str) -> AppResult<Vec<CheckRun>> {
    let (o, r) = (valid_name(owner)?, valid_name(name)?);
    let sha = crate::git::validate::commit_hash(sha)?;
    let (rp, sp) = (
        format!("/repos/{o}/{r}/commits/{sha}/check-runs?per_page=100"),
        format!("/repos/{o}/{r}/commits/{sha}/status"),
    );
    let (runs, st) = tokio::join!(get(token, &rp), get(token, &sp));
    Ok(parse_checks(&runs?, &st?))
}

pub async fn comment(
    token: &str,
    owner: &str,
    name: &str,
    number: u32,
    body: &str,
) -> AppResult<()> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::invalid("Write a comment first."));
    }
    let path = format!(
        "/repos/{}/{}/issues/{number}/comments",
        valid_name(owner)?,
        valid_name(name)?
    );
    send(api_req(&client()?, reqwest::Method::POST, &path, token).json(&json!({ "body": body })))
        .await?;
    Ok(())
}

pub async fn review(
    token: &str,
    owner: &str,
    name: &str,
    number: u32,
    event: ReviewEvent,
    body: &str,
) -> AppResult<()> {
    let body = body.trim();
    let event = match event {
        ReviewEvent::Comment => "COMMENT",
        ReviewEvent::Approve => "APPROVE",
        ReviewEvent::RequestChanges => "REQUEST_CHANGES",
    };
    if body.is_empty() && event != "APPROVE" {
        return Err(AppError::invalid(
            "Explain what should change (or approve without a comment).",
        ));
    }
    let path = format!("{}/reviews", base(owner, name, number)?);
    send(
        api_req(&client()?, reqwest::Method::POST, &path, token)
            .json(&json!({ "event": event, "body": body })),
    )
    .await?;
    Ok(())
}

/// Merges the pull request, but only if its head is still `sha` (what the user reviewed).
pub async fn merge(
    token: &str,
    owner: &str,
    name: &str,
    number: u32,
    method: MergeMethod,
    sha: &str,
) -> AppResult<()> {
    let sha = crate::git::validate::commit_hash(sha)?;
    let method = match method {
        MergeMethod::Merge => "merge",
        MergeMethod::Squash => "squash",
        MergeMethod::Rebase => "rebase",
    };
    let path = format!("{}/merge", base(owner, name, number)?);
    let req = api_req(&client()?, reqwest::Method::PUT, &path, token)
        .json(&json!({ "merge_method": method, "sha": sha }));
    send(req).await.map_err(|e| {
        if e.detail.as_deref().is_some_and(|d| d.starts_with("HTTP 409")) {
            AppError::new(ErrorKind::GithubFailed, "New commits were pushed to the pull request after you opened it. Reload it, check the changes, then merge.").with_detail(e.detail.unwrap_or_default())
        } else if e.detail.as_deref().is_some_and(|d| d.starts_with("HTTP 405")) {
            AppError::new(ErrorKind::GithubFailed, "GitHub won't merge this pull request yet: required checks or reviews may be missing, or this merge method is turned off for the repository.").with_detail(e.detail.unwrap_or_default())
        } else {
            e
        }
    })?;
    Ok(())
}

/// Deletes the pull request's branch on GitHub (same-repository pull requests only).
pub async fn delete_branch(token: &str, owner: &str, name: &str, branch: &str) -> AppResult<()> {
    let branch = crate::git::validate::ref_name(branch)?;
    let path = format!(
        "/repos/{}/{}/git/refs/heads/{branch}",
        valid_name(owner)?,
        valid_name(name)?
    );
    send(api_req(&client()?, reqwest::Method::DELETE, &path, token)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_detail_and_merged_state() {
        let v = json!({
            "number": 7, "title": "Fix", "body": null, "html_url": "https://github.com/o/r/pull/7",
            "user": {"login": "ana"}, "state": "closed", "merged_at": "2026-01-02T00:00:00Z", "draft": false,
            "head": {"ref": "fix", "sha": "abc123", "repo": {"full_name": "ana/r"}},
            "base": {"ref": "main", "repo": {"full_name": "o/r"}},
            "mergeable": null, "additions": 3, "deletions": 1, "changed_files": 2
        });
        let d = parse_detail(&v).unwrap();
        assert_eq!(d.state, "merged");
        assert_eq!(d.body, "");
        assert!(d.cross_repository);
        assert_eq!(d.mergeable, None);
        assert_eq!(d.mergeable_state, "unknown");
        assert_eq!((d.additions, d.deletions, d.changed_files), (3, 1, 2));
    }

    #[test]
    fn turns_patches_into_diffs() {
        let f = parse_file(&json!({
            "filename": "src/new.rs", "previous_filename": "src/old.rs", "status": "renamed",
            "additions": 1, "deletions": 1, "patch": "@@ -1,2 +1,2 @@\n a\n-b\n+c"
        }))
        .unwrap();
        let d = f.diff.unwrap();
        assert!(d.renamed);
        assert_eq!(d.new_path.as_deref(), Some("src/new.rs"));
        assert_eq!((d.additions, d.deletions), (1, 1));
        assert!(!d.hunk_actions);

        let added = parse_file(
            &json!({"filename": "a.txt", "status": "added", "patch": "@@ -0,0 +1 @@\n+hi"}),
        )
        .unwrap();
        assert!(added.diff.unwrap().new_file);
        let binary = parse_file(&json!({"filename": "a.png", "status": "added"})).unwrap();
        assert!(binary.diff.is_none());
    }

    #[test]
    fn merges_the_conversation_in_time_order() {
        let c = json!([{"user": {"login": "b"}, "body": "second", "created_at": "2026-01-02T00:00:00Z", "html_url": "u2"}]);
        let r = json!([
            {"user": {"login": "a"}, "body": "", "state": "APPROVED", "submitted_at": "2026-01-03T00:00:00Z", "html_url": "u3"},
            {"user": {"login": "a"}, "body": "", "state": "COMMENTED", "submitted_at": "2026-01-01T00:00:00Z", "html_url": "u0"},
            {"user": {"login": "a"}, "body": "x", "state": "PENDING", "submitted_at": "2026-01-01T00:00:00Z", "html_url": "u0"}
        ]);
        let l = json!([{"user": {"login": "a"}, "body": "first", "created_at": "2026-01-01T00:00:00Z", "path": "a.rs", "line": null, "original_line": 4, "html_url": "u1"}]);
        let all = parse_conversation(&c, &r, &l);
        assert_eq!(
            all.iter().map(|x| x.url.as_str()).collect::<Vec<_>>(),
            ["u1", "u2", "u3"]
        );
        assert_eq!(all[0].line, Some(4));
        assert!(all[0].outdated, "line null = no longer in the diff");
        let on_diff = parse_conversation(
            &json!([]),
            &json!([]),
            &json!([{"user": {"login": "a"}, "body": "x", "created_at": "t", "path": "a.rs", "line": 9, "side": "LEFT", "html_url": "u"}]),
        );
        assert_eq!(
            (
                on_diff[0].line,
                on_diff[0].side.as_deref(),
                on_diff[0].outdated
            ),
            (Some(9), Some("LEFT"), false)
        );
        assert_eq!(all[2].review_state.as_deref(), Some("APPROVED"));
    }

    #[test]
    fn reads_check_runs_and_statuses() {
        let runs = json!({"check_runs": [
            {"name": "build", "status": "completed", "conclusion": "success", "html_url": "h"},
            {"name": "lint", "status": "in_progress", "conclusion": null},
            {"name": "e2e", "status": "completed", "conclusion": "timed_out", "details_url": "d"}
        ]});
        let st =
            json!({"statuses": [{"context": "ci/legacy", "state": "error", "target_url": "t"}]});
        let c = parse_checks(&runs, &st);
        assert_eq!(
            c.iter().map(|x| x.result.as_str()).collect::<Vec<_>>(),
            ["success", "pending", "timedOut", "failure"]
        );
        assert_eq!(c[2].url.as_deref(), Some("d"));
    }
}

// ---------- issues ----------

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Issue {
    pub number: u32,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub comments: u32,
    /// ISO 8601.
    pub updated_at: String,
}

/// Issues from `/repos/{o}/{r}/issues`, which also lists pull requests: those are left out.
pub fn parse_issues(v: &Value) -> Vec<Issue> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|i| i.get("pull_request").is_none())
        .filter_map(|i| {
            Some(Issue {
                number: i["number"].as_u64()? as u32,
                title: s(&i["title"]),
                url: s(&i["html_url"]),
                author: login(&i["user"]),
                labels: i["labels"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|l| l["name"].as_str().map(str::to_string))
                    .collect(),
                assignees: i["assignees"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(login)
                    .collect(),
                comments: n(&i["comments"]),
                updated_at: s(&i["updated_at"]),
            })
        })
        .collect()
}

/// Open issues, most recently updated first (up to 300).
pub async fn issues(token: &str, owner: &str, name: &str) -> AppResult<Vec<Issue>> {
    let (o, r) = (valid_name(owner)?, valid_name(name)?);
    let mut out = Vec::new();
    for page in 1..=3 {
        let v = get(
            token,
            &format!("/repos/{o}/{r}/issues?state=open&sort=updated&per_page=100&page={page}"),
        )
        .await?;
        let full = v.as_array().is_some_and(|a| a.len() == 100);
        out.extend(parse_issues(&v));
        if !full {
            break;
        }
    }
    Ok(out)
}

pub async fn create_issue(
    token: &str,
    owner: &str,
    name: &str,
    title: &str,
    body: &str,
) -> AppResult<Issue> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid("Enter a title for the issue."));
    }
    let path = format!("/repos/{}/{}/issues", valid_name(owner)?, valid_name(name)?);
    let v = send(
        api_req(&client()?, reqwest::Method::POST, &path, token)
            .json(&json!({ "title": title, "body": body })),
    )
    .await?;
    parse_issues(&Value::Array(vec![v.clone()]))
        .pop()
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::GithubFailed,
                "GitHub sent an unexpected response.",
            )
            .with_detail(v.to_string())
        })
}

#[cfg(test)]
mod issue_tests {
    use super::*;

    #[test]
    fn issues_leave_out_pull_requests() {
        let v = json!([
            {"number": 3, "title": "Crash on start", "html_url": "u", "user": {"login": "ann"}, "labels": [{"name": "bug"}], "assignees": [{"login": "me"}], "comments": 2, "updated_at": "t"},
            {"number": 4, "title": "A PR", "pull_request": {"url": "x"}}
        ]);
        let i = parse_issues(&v);
        assert_eq!(i.len(), 1);
        assert_eq!(i[0].labels, ["bug"]);
        assert_eq!(i[0].assignees, ["me"]);
        assert_eq!(i[0].comments, 2);
    }
}
