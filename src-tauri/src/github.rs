//! GitHub: sign-in (OAuth device flow or a personal access token), the user's repositories,
//! and pull requests. Only talks to github.com's API; Git itself keeps using the user's own
//! credentials (credential manager or SSH keys) for clone, fetch and push.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

pub const API: &str = "https://api.github.com";
const LOGIN: &str = "https://github.com/login";
/// `repo`: read private repositories and open pull requests.
pub const SCOPES: &str = "repo";
/// Most repositories listed for cloning (10 pages of 100).
const MAX_REPO_PAGES: u32 = 10;
/// Open pull requests listed per repository.
const MAX_PULLS: u32 = 50;

/// OAuth app client ID built into this version (set `GITPILOT_GITHUB_CLIENT_ID` when building).
pub fn builtin_client_id() -> Option<&'static str> {
    option_env!("GITPILOT_GITHUB_CLIENT_ID").filter(|s| is_valid_client_id(s))
}

/// The client ID to use for device-flow sign-in: the one in Settings, else the built-in one.
pub fn client_id(configured: &str) -> Option<String> {
    let c = configured.trim();
    if !c.is_empty() {
        return is_valid_client_id(c).then(|| c.to_string());
    }
    builtin_client_id().map(String::from)
}

pub fn is_valid_client_id(id: &str) -> bool {
    (1..=100).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// GitHub user and repository names: letters, digits, '-', '_' and '.'.
pub fn valid_name(s: &str) -> AppResult<&str> {
    let ok = !s.is_empty()
        && s.len() <= 100
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok {
        Ok(s)
    } else {
        Err(AppError::invalid(format!(
            "'{s}' isn't a valid GitHub owner or repository name."
        )))
    }
}

// ---------- types ----------

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitHubUser {
    pub login: String,
    pub name: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitHubAccount {
    /// The signed-in user; `None` when not signed in or the token was rejected.
    pub user: Option<GitHubUser>,
    /// Where the token comes from: "keychain" or an environment variable's name.
    pub token_source: Option<String>,
    /// A token is set but GitHub refused it (expired or revoked).
    pub token_rejected: bool,
    pub keychain_available: bool,
    /// "Sign in with GitHub" (device flow) is available: an OAuth client ID is configured.
    pub device_flow: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeviceCode {
    /// Shown to the user, e.g. "WDJB-MJHT".
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u32,
}

/// A device-flow sign-in waiting for the user. Kept in the backend; the webview never sees
/// the device code.
#[derive(Debug, Clone)]
pub struct PendingDevice {
    pub client_id: String,
    pub device_code: String,
    pub interval: Duration,
    pub expires_at: Instant,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitHubRepo {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    /// ISO 8601 time of the last push.
    pub pushed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitHubRepoRef {
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub html_url: String,
    pub default_branch: String,
    /// The local remote that points at this repository, if there is one.
    pub remote: Option<String>,
}

/// The GitHub repository a local repository's remote points at.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitHubLink {
    pub repo: GitHubRepoRef,
    /// For forks: the repository it was forked from (where pull requests usually go).
    pub parent: Option<GitHubRepoRef>,
    /// The signed-in user can push to `repo`.
    pub can_push: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChecksState {
    Passing,
    Failing,
    Pending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub draft: bool,
    /// ISO 8601.
    pub created_at: String,
    /// ISO 8601.
    pub updated_at: String,
    pub head_ref: String,
    /// Owner of the repository the changes come from (`None` if it was deleted).
    pub head_owner: Option<String>,
    /// The changes come from another repository (a fork).
    pub cross_repository: bool,
    pub base_ref: String,
    /// Combined result of checks and statuses on the latest commit; `None` when there are none.
    pub checks: Option<ChecksState>,
    pub review: Option<ReviewState>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreatedPull {
    pub number: u32,
    pub url: String,
}

/// What a pull request's head is, for checking it out.
#[derive(Debug, Clone, PartialEq)]
pub struct PullHead {
    pub head_ref: String,
    /// Changes come from another repository, or from a deleted fork.
    pub cross_repository: bool,
}

// ---------- remote URLs ----------

/// `owner/name` of a github.com remote URL (https, ssh or scp-like; credentials ignored).
pub fn parse_remote_url(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let path = if let Some(rest) = u.strip_prefix("git@github.com:") {
        rest
    } else {
        let (_, rest) = u.split_once("://")?;
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?;
        let host = host.split(':').next()?;
        if !host.eq_ignore_ascii_case("github.com") && !host.eq_ignore_ascii_case("www.github.com")
        {
            return None;
        }
        path
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    if parts.next().is_some() || valid_name(owner).is_err() || valid_name(name).is_err() {
        return None;
    }
    Some((owner.to_string(), name.to_string()))
}

/// Splits an upstream like "origin/feature/x" into its remote and branch, given the remote names.
pub fn split_upstream<'a>(upstream: &'a str, remotes: &[String]) -> Option<(&'a str, &'a str)> {
    remotes
        .iter()
        .filter(|r| upstream.len() > r.len() + 1 && upstream.starts_with(&format!("{r}/")))
        .max_by_key(|r| r.len())
        .map(|r| (&upstream[..r.len()], &upstream[r.len() + 1..]))
}

// ---------- HTTP ----------

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("GitPilot/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| {
            AppError::internal("Couldn't create an HTTP client.").with_detail(e.to_string())
        })
}

fn api_req(
    c: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
    token: &str,
) -> reqwest::RequestBuilder {
    c.request(method, format!("{API}{path}"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

fn network_err(e: reqwest::Error) -> AppError {
    AppError::new(
        ErrorKind::NetworkFailed,
        "Couldn't reach GitHub. Check your internet connection.",
    )
    .with_detail(e.to_string())
}

/// Maps a failed API response to a plain-language error.
pub fn api_error(status: u16, body: &str, rate_limited: bool) -> AppError {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let gh_msg = v["message"].as_str().unwrap_or("").to_string();
    let first_error = v["errors"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|e| e["message"].as_str().or_else(|| e["code"].as_str()))
        .unwrap_or("")
        .to_string();
    let detail = format!(
        "HTTP {status}: {}",
        body.chars().take(800).collect::<String>()
    );
    let (kind, message) = match status {
        401 => (
            ErrorKind::GithubNotSignedIn,
            "GitHub didn't accept your sign-in. It may have expired or been revoked. Sign in again in Settings → GitHub.".to_string(),
        ),
        403 | 429 if rate_limited => (
            ErrorKind::GithubFailed,
            "GitHub's request limit was reached. Wait a few minutes and try again.".to_string(),
        ),
        403 => (
            ErrorKind::GithubFailed,
            "GitHub refused the request. Your account may not have access, or the organization may need to approve GitPilot.".to_string(),
        ),
        404 => (
            ErrorKind::GithubFailed,
            "GitHub couldn't find that repository, or your account doesn't have access to it.".to_string(),
        ),
        422 => {
            let why = if !first_error.is_empty() {
                first_error
            } else if !gh_msg.is_empty() {
                gh_msg
            } else {
                "the request was rejected".to_string()
            };
            (ErrorKind::GithubFailed, format!("GitHub said: {why}"))
        }
        500..=599 => (
            ErrorKind::GithubFailed,
            "GitHub had a server error. Try again later.".to_string(),
        ),
        _ => (ErrorKind::GithubFailed, "GitHub returned an error.".to_string()),
    };
    AppError::new(kind, message).with_detail(detail)
}

async fn send(req: reqwest::RequestBuilder) -> AppResult<Value> {
    let resp = req.send().await.map_err(network_err)?;
    let status = resp.status();
    let rate_limited = resp
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|h| h.to_str().ok())
        == Some("0");
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &body, rate_limited));
    }
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body).map_err(|e| {
        AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unreadable response.",
        )
        .with_detail(e.to_string())
    })
}

async fn get(token: &str, path: &str) -> AppResult<Value> {
    send(api_req(&client()?, reqwest::Method::GET, path, token)).await
}

async fn graphql(token: &str, query: &str, variables: Value) -> AppResult<Value> {
    let req = api_req(&client()?, reqwest::Method::POST, "/graphql", token)
        .json(&json!({ "query": query, "variables": variables }));
    let body = send(req).await?;
    if let Some(errs) = body["errors"].as_array().filter(|a| !a.is_empty()) {
        let msg = errs[0]["message"].as_str().unwrap_or("Unknown error");
        let kind = errs[0]["type"].as_str().unwrap_or("");
        let message = if kind == "NOT_FOUND" {
            "GitHub couldn't find that repository, or your account doesn't have access to it."
                .to_string()
        } else {
            format!("GitHub said: {msg}")
        };
        return Err(AppError::new(ErrorKind::GithubFailed, message).with_detail(body.to_string()));
    }
    Ok(body)
}

pub fn not_signed_in() -> AppError {
    AppError::new(
        ErrorKind::GithubNotSignedIn,
        "Sign in to GitHub first (Settings → GitHub).",
    )
}

// ---------- account ----------

pub fn parse_user(v: &Value) -> Option<GitHubUser> {
    Some(GitHubUser {
        login: v["login"].as_str()?.to_string(),
        name: v["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(String::from),
        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
    })
}

/// The user a token belongs to. Fails with `GithubNotSignedIn` if GitHub rejects the token.
pub async fn user(token: &str) -> AppResult<GitHubUser> {
    let v = get(token, "/user").await?;
    parse_user(&v).ok_or_else(|| {
        AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unexpected response.",
        )
        .with_detail(v.to_string())
    })
}

/// Starts device-flow sign-in: GitHub returns a code for the user to enter at github.com/login/device.
pub async fn device_start(client_id: &str) -> AppResult<(DeviceCode, PendingDevice)> {
    let req = client()?
        .post(format!("{LOGIN}/device/code"))
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPES)]);
    let v = send(req).await?;
    let (Some(device_code), Some(user_code), Some(uri)) = (
        v["device_code"].as_str(),
        v["user_code"].as_str(),
        v["verification_uri"].as_str(),
    ) else {
        let why = v["error_description"]
            .as_str()
            .unwrap_or("unexpected response");
        return Err(AppError::new(
            ErrorKind::GithubFailed,
            format!("GitHub couldn't start the sign-in: {why}. Check the client ID in Settings → GitHub (device flow must be enabled for the app)."),
        )
        .with_detail(v.to_string()));
    };
    let expires_in = v["expires_in"].as_u64().unwrap_or(900).clamp(60, 3600);
    let interval = v["interval"].as_u64().unwrap_or(5).clamp(1, 60);
    Ok((
        DeviceCode {
            user_code: user_code.to_string(),
            verification_uri: uri.to_string(),
            expires_in: expires_in as u32,
        },
        PendingDevice {
            client_id: client_id.to_string(),
            device_code: device_code.to_string(),
            interval: Duration::from_secs(interval),
            expires_at: Instant::now() + Duration::from_secs(expires_in),
        },
    ))
}

/// One answer while polling for the device-flow token.
#[derive(Debug, PartialEq)]
pub enum Poll {
    Token(String),
    Pending,
    /// Poll less often; GitHub may say the new interval.
    SlowDown(Option<u64>),
    Failed(String),
}

pub fn parse_poll(v: &Value) -> Poll {
    if let Some(t) = v["access_token"].as_str().filter(|t| !t.is_empty()) {
        return Poll::Token(t.to_string());
    }
    match v["error"].as_str() {
        Some("authorization_pending") => Poll::Pending,
        Some("slow_down") => Poll::SlowDown(v["interval"].as_u64()),
        Some("expired_token") => Poll::Failed(
            "The sign-in code expired before it was entered. Start again.".into(),
        ),
        Some("access_denied") => Poll::Failed("Sign-in was cancelled on GitHub.".into()),
        Some("device_flow_disabled") => Poll::Failed(
            "Device sign-in isn't enabled for this GitHub app. Use a personal access token instead.".into(),
        ),
        Some("incorrect_client_credentials") => Poll::Failed(
            "GitHub doesn't recognize the client ID. Check it in Settings → GitHub.".into(),
        ),
        Some(other) => Poll::Failed(format!(
            "GitHub sign-in failed ({}).",
            v["error_description"].as_str().unwrap_or(other)
        )),
        None => Poll::Failed("GitHub sent an unexpected response.".into()),
    }
}

/// Waits until the user has entered the code (or it expires, or `cancel` fires). Returns the token.
pub async fn device_wait(p: PendingDevice, cancel: &tokio::sync::Notify) -> AppResult<String> {
    let c = client()?;
    let mut interval = p.interval;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = cancel.notified() => {
                return Err(AppError::new(ErrorKind::Cancelled, "Sign-in cancelled."));
            }
        }
        if Instant::now() >= p.expires_at {
            return Err(AppError::new(
                ErrorKind::GithubFailed,
                "The sign-in code expired before it was entered. Start again.",
            ));
        }
        let req = c
            .post(format!("{LOGIN}/oauth/access_token"))
            .header("Accept", "application/json")
            .form(&[
                ("client_id", p.client_id.as_str()),
                ("device_code", p.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ]);
        // A dropped connection while waiting is not fatal; try again at the next interval.
        let v = match send(req).await {
            Ok(v) => v,
            Err(e) if e.kind == ErrorKind::NetworkFailed => continue,
            Err(e) => return Err(e),
        };
        match parse_poll(&v) {
            Poll::Token(t) => return Ok(t),
            Poll::Pending => {}
            Poll::SlowDown(next) => {
                interval = next
                    .map(Duration::from_secs)
                    .unwrap_or(interval + Duration::from_secs(5))
                    .min(Duration::from_secs(60));
            }
            Poll::Failed(msg) => {
                return Err(AppError::new(ErrorKind::GithubFailed, msg).with_detail(v.to_string()))
            }
        }
    }
}

// ---------- repositories ----------

pub fn parse_repo(v: &Value) -> Option<GitHubRepo> {
    Some(GitHubRepo {
        full_name: v["full_name"].as_str()?.to_string(),
        owner: v["owner"]["login"].as_str()?.to_string(),
        name: v["name"].as_str()?.to_string(),
        description: v["description"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(String::from),
        private: v["private"].as_bool().unwrap_or(false),
        fork: v["fork"].as_bool().unwrap_or(false),
        archived: v["archived"].as_bool().unwrap_or(false),
        clone_url: v["clone_url"].as_str()?.to_string(),
        ssh_url: v["ssh_url"].as_str().unwrap_or_default().to_string(),
        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
        pushed_at: v["pushed_at"].as_str().map(String::from),
    })
}

/// Repositories the user owns, collaborates on, or can reach through an organization,
/// most recently pushed first.
pub async fn repos(token: &str) -> AppResult<Vec<GitHubRepo>> {
    let mut out = Vec::new();
    for page in 1..=MAX_REPO_PAGES {
        let v = get(
            token,
            &format!("/user/repos?per_page=100&page={page}&sort=pushed&affiliation=owner,collaborator,organization_member"),
        )
        .await?;
        let list = v.as_array().cloned().unwrap_or_default();
        let n = list.len();
        out.extend(list.iter().filter_map(parse_repo));
        if n < 100 {
            break;
        }
    }
    Ok(out)
}

fn parse_repo_ref(v: &Value) -> Option<GitHubRepoRef> {
    Some(GitHubRepoRef {
        owner: v["owner"]["login"].as_str()?.to_string(),
        name: v["name"].as_str()?.to_string(),
        full_name: v["full_name"].as_str()?.to_string(),
        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
        default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
        remote: None,
    })
}

/// A repository and the one it was forked from, as `GET /repos/{owner}/{name}` returns them.
pub fn parse_link(v: &Value) -> Option<GitHubLink> {
    Some(GitHubLink {
        repo: parse_repo_ref(v)?,
        parent: parse_repo_ref(&v["parent"]),
        can_push: v["permissions"]["push"].as_bool().unwrap_or(false),
    })
}

pub async fn repo_link(token: &str, owner: &str, name: &str) -> AppResult<GitHubLink> {
    let v = get(
        token,
        &format!("/repos/{}/{}", valid_name(owner)?, valid_name(name)?),
    )
    .await?;
    parse_link(&v).ok_or_else(|| {
        AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unexpected response.",
        )
        .with_detail(v.to_string())
    })
}

// ---------- pull requests ----------

const PULLS_QUERY: &str = "query($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url isDraft createdAt updatedAt
        author { login }
        headRefName baseRefName isCrossRepository
        headRepositoryOwner { login }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}";

pub fn parse_pulls(v: &Value) -> Vec<PullRequest> {
    let Some(nodes) = v["data"]["repository"]["pullRequests"]["nodes"].as_array() else {
        return Vec::new();
    };
    nodes
        .iter()
        .filter_map(|n| {
            let checks = n["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]
                .as_str()
                .and_then(|s| match s {
                    "SUCCESS" => Some(ChecksState::Passing),
                    "FAILURE" | "ERROR" => Some(ChecksState::Failing),
                    "PENDING" | "EXPECTED" => Some(ChecksState::Pending),
                    _ => None,
                });
            let review = n["reviewDecision"].as_str().and_then(|s| match s {
                "APPROVED" => Some(ReviewState::Approved),
                "CHANGES_REQUESTED" => Some(ReviewState::ChangesRequested),
                "REVIEW_REQUIRED" => Some(ReviewState::ReviewRequired),
                _ => None,
            });
            Some(PullRequest {
                number: u32::try_from(n["number"].as_u64()?).ok()?,
                title: n["title"].as_str()?.to_string(),
                url: n["url"].as_str()?.to_string(),
                author: n["author"]["login"].as_str().map(String::from),
                draft: n["isDraft"].as_bool().unwrap_or(false),
                created_at: n["createdAt"].as_str().unwrap_or_default().to_string(),
                updated_at: n["updatedAt"].as_str().unwrap_or_default().to_string(),
                head_ref: n["headRefName"].as_str()?.to_string(),
                head_owner: n["headRepositoryOwner"]["login"].as_str().map(String::from),
                cross_repository: n["isCrossRepository"].as_bool().unwrap_or(false),
                base_ref: n["baseRefName"].as_str()?.to_string(),
                checks,
                review,
            })
        })
        .collect()
}

/// Open pull requests, most recently updated first, with their checks and review state.
pub async fn pulls(token: &str, owner: &str, name: &str) -> AppResult<Vec<PullRequest>> {
    let v = graphql(
        token,
        PULLS_QUERY,
        json!({ "owner": valid_name(owner)?, "name": valid_name(name)?, "first": MAX_PULLS }),
    )
    .await?;
    if v["data"]["repository"].is_null() {
        return Err(AppError::new(
            ErrorKind::GithubFailed,
            "GitHub couldn't find that repository, or your account doesn't have access to it.",
        ));
    }
    Ok(parse_pulls(&v))
}

pub fn parse_pull_head(v: &Value) -> Option<PullHead> {
    let head_repo = v["head"]["repo"]["full_name"].as_str();
    let base_repo = v["base"]["repo"]["full_name"].as_str()?;
    Some(PullHead {
        head_ref: v["head"]["ref"].as_str()?.to_string(),
        cross_repository: !matches!(head_repo, Some(h) if h.eq_ignore_ascii_case(base_repo)),
    })
}

pub async fn pull_head(token: &str, owner: &str, name: &str, number: u32) -> AppResult<PullHead> {
    let v = get(
        token,
        &format!(
            "/repos/{}/{}/pulls/{number}",
            valid_name(owner)?,
            valid_name(name)?
        ),
    )
    .await?;
    parse_pull_head(&v).ok_or_else(|| {
        AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unexpected response.",
        )
        .with_detail(v.to_string())
    })
}

/// The `head` value for creating a pull request: the branch name when it lives in the base
/// repository, otherwise `owner:branch`.
pub fn pull_head_param(
    base_owner: &str,
    base_name: &str,
    head: (&str, &str),
    branch: &str,
) -> String {
    let same = head.0.eq_ignore_ascii_case(base_owner) && head.1.eq_ignore_ascii_case(base_name);
    if same {
        branch.to_string()
    } else {
        format!("{}:{branch}", head.0)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn create_pull(
    token: &str,
    owner: &str,
    name: &str,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> AppResult<CreatedPull> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::invalid("Enter a title for the pull request."));
    }
    let req = api_req(
        &client()?,
        reqwest::Method::POST,
        &format!("/repos/{}/{}/pulls", valid_name(owner)?, valid_name(name)?),
        token,
    )
    .json(&json!({ "title": title, "body": body, "head": head, "base": base, "draft": draft }));
    let v = send(req).await?;
    match (v["number"].as_u64(), v["html_url"].as_str()) {
        (Some(n), Some(url)) => Ok(CreatedPull {
            number: n as u32,
            url: url.to_string(),
        }),
        _ => Err(AppError::new(
            ErrorKind::GithubFailed,
            "GitHub sent an unexpected response.",
        )
        .with_detail(v.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_remote_urls() {
        let o = |s: &str| parse_remote_url(s);
        let want = Some(("octo".to_string(), "hello-world".to_string()));
        assert_eq!(o("https://github.com/octo/hello-world.git"), want);
        assert_eq!(o("https://github.com/octo/hello-world"), want);
        assert_eq!(o("https://***@github.com/octo/hello-world.git/"), want);
        assert_eq!(o("git@github.com:octo/hello-world.git"), want);
        assert_eq!(o("ssh://git@github.com/octo/hello-world.git"), want);
        assert_eq!(o("ssh://git@github.com:22/octo/hello-world"), want);
        assert_eq!(o("https://gitlab.com/octo/hello-world.git"), None);
        assert_eq!(o("https://github.com.evil.com/octo/x"), None);
        assert_eq!(o("https://github.com/octo"), None);
        assert_eq!(o("https://github.com/octo/x/tree/main"), None);
        assert_eq!(o("/home/me/repo"), None);
    }

    #[test]
    fn splits_upstream_by_longest_remote() {
        let remotes = vec!["origin".to_string(), "origin/fork".to_string()];
        assert_eq!(
            split_upstream("origin/feature/x", &remotes),
            Some(("origin", "feature/x"))
        );
        assert_eq!(
            split_upstream("origin/fork/main", &remotes),
            Some(("origin/fork", "main"))
        );
        assert_eq!(split_upstream("upstream/main", &remotes), None);
        assert_eq!(split_upstream("origin/", &remotes), None);
    }

    #[test]
    fn validates_names_and_client_ids() {
        assert!(valid_name("my.repo_name-2").is_ok());
        assert!(valid_name("a/b").is_err());
        assert!(valid_name("..").is_err());
        assert!(valid_name("").is_err());
        assert!(is_valid_client_id("Ov23liAbC123"));
        assert!(is_valid_client_id("Iv1.0123abcd"));
        assert!(!is_valid_client_id("abc def"));
        assert!(!is_valid_client_id(""));
        assert_eq!(client_id(" Ov23liX "), Some("Ov23liX".to_string()));
        assert_eq!(client_id("bad id"), None);
    }

    #[test]
    fn parses_device_poll_answers() {
        assert_eq!(
            parse_poll(&json!({"access_token": "gho_x", "token_type": "bearer"})),
            Poll::Token("gho_x".into())
        );
        assert_eq!(
            parse_poll(&json!({"error": "authorization_pending"})),
            Poll::Pending
        );
        assert_eq!(
            parse_poll(&json!({"error": "slow_down", "interval": 10})),
            Poll::SlowDown(Some(10))
        );
        assert!(
            matches!(parse_poll(&json!({"error": "access_denied"})), Poll::Failed(m) if m.contains("cancelled"))
        );
        assert!(
            matches!(parse_poll(&json!({"error": "expired_token"})), Poll::Failed(m) if m.contains("expired"))
        );
        assert!(matches!(parse_poll(&json!({})), Poll::Failed(_)));
    }

    #[test]
    fn maps_api_errors() {
        assert_eq!(
            api_error(401, "{}", false).kind,
            ErrorKind::GithubNotSignedIn
        );
        assert!(api_error(403, "{}", true).message.contains("limit"));
        assert!(api_error(403, "{}", false).message.contains("refused"));
        let e = api_error(
            422,
            r#"{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A pull request already exists for octo:feature."}]}"#,
            false,
        );
        assert_eq!(
            e.message,
            "GitHub said: A pull request already exists for octo:feature."
        );
        assert_eq!(
            api_error(422, r#"{"message":"No commits between main and x"}"#, false).message,
            "GitHub said: No commits between main and x"
        );
        assert!(e.detail.unwrap().starts_with("HTTP 422"));
    }

    #[test]
    fn parses_repos_links_and_pulls() {
        let r = parse_repo(&json!({
            "full_name": "octo/app", "name": "app", "owner": {"login": "octo"},
            "description": "", "private": true, "fork": false, "archived": false,
            "clone_url": "https://github.com/octo/app.git", "ssh_url": "git@github.com:octo/app.git",
            "html_url": "https://github.com/octo/app", "pushed_at": "2026-10-20T10:00:00Z"
        }))
        .unwrap();
        assert!(r.private);
        assert_eq!(r.description, None);
        assert_eq!(r.ssh_url, "git@github.com:octo/app.git");

        let l = parse_link(&json!({
            "full_name": "me/app", "name": "app", "owner": {"login": "me"}, "html_url": "https://github.com/me/app",
            "default_branch": "dev", "fork": true, "permissions": {"push": true},
            "parent": {"full_name": "octo/app", "name": "app", "owner": {"login": "octo"}, "default_branch": "main", "html_url": "https://github.com/octo/app"}
        }))
        .unwrap();
        assert_eq!(l.repo.default_branch, "dev");
        assert!(l.can_push);
        assert_eq!(l.parent.unwrap().full_name, "octo/app");

        let p = parse_pulls(&json!({"data": {"repository": {"pullRequests": {"nodes": [
            {"number": 7, "title": "Add login", "url": "https://github.com/octo/app/pull/7", "isDraft": false,
             "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-10-02T00:00:00Z", "author": {"login": "ann"},
             "headRefName": "login", "baseRefName": "main", "isCrossRepository": true, "headRepositoryOwner": {"login": "ann"},
             "reviewDecision": "APPROVED", "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "FAILURE"}}}]}},
            {"number": 8, "title": "Docs", "url": "u", "isDraft": true, "createdAt": "", "updatedAt": "", "author": null,
             "headRefName": "docs", "baseRefName": "main", "isCrossRepository": false, "headRepositoryOwner": null,
             "reviewDecision": null, "commits": {"nodes": [{"commit": {"statusCheckRollup": null}}]}}
        ]}}}}));
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].checks, Some(ChecksState::Failing));
        assert_eq!(p[0].review, Some(ReviewState::Approved));
        assert_eq!(p[0].head_owner.as_deref(), Some("ann"));
        assert!(p[1].draft);
        assert_eq!(
            (p[1].checks, p[1].review, p[1].author.clone()),
            (None, None, None)
        );
    }

    #[test]
    fn pull_heads() {
        let h = parse_pull_head(&json!({"head": {"ref": "fix", "repo": {"full_name": "ann/app"}}, "base": {"repo": {"full_name": "octo/app"}}})).unwrap();
        assert!(h.cross_repository);
        let h = parse_pull_head(&json!({"head": {"ref": "fix", "repo": {"full_name": "Octo/App"}}, "base": {"repo": {"full_name": "octo/app"}}})).unwrap();
        assert!(!h.cross_repository);
        let h = parse_pull_head(&json!({"head": {"ref": "fix", "repo": null}, "base": {"repo": {"full_name": "octo/app"}}})).unwrap();
        assert!(h.cross_repository, "deleted fork");

        assert_eq!(
            pull_head_param("octo", "app", ("octo", "app"), "feature"),
            "feature"
        );
        assert_eq!(
            pull_head_param("octo", "app", ("me", "app"), "feature"),
            "me:feature"
        );
    }
}
