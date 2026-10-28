//! GitHub sign-in, repositories and pull requests.

use tauri::{AppHandle, State};

use super::changes::repo;
use super::{ctx, progress};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::pulls::PrCheckout;
use crate::git::refs::Remote;
use crate::git::Repo;
use crate::github::{
    self, CreatedPull, DeviceCode, GitHubAccount, GitHubLink, GitHubRepo, GitHubUser, PullRequest,
};
use crate::secrets;
use crate::state::AppState;

fn token() -> AppResult<String> {
    secrets::github_token()
        .map(|(t, _)| t)
        .ok_or_else(github::not_signed_in)
}

/// Signing in stores the token in the keychain, so check it's usable before asking the user.
fn require_keychain() -> AppResult<()> {
    if secrets::github_status().keychain_available {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::Keychain,
            "The system keychain isn't available, so GitPilot can't keep your GitHub sign-in. On Linux this needs a Secret Service (e.g. GNOME Keyring or KWallet). You can set the GITPILOT_GITHUB_TOKEN environment variable instead.",
        ))
    }
}

/// GitHub remotes of a repository: (remote name, owner, repository name).
fn github_remotes(remotes: &[Remote]) -> Vec<(String, String, String)> {
    remotes
        .iter()
        .filter_map(|r| github::parse_remote_url(&r.fetch_url).map(|(o, n)| (r.name.clone(), o, n)))
        .collect()
}

fn remote_for<'a>(gh: &'a [(String, String, String)], owner: &str, name: &str) -> Option<&'a str> {
    gh.iter()
        .find(|(_, o, n)| o.eq_ignore_ascii_case(owner) && n.eq_ignore_ascii_case(name))
        .map(|(r, _, _)| r.as_str())
}

#[tauri::command]
pub async fn github_account(state: State<'_, AppState>) -> AppResult<GitHubAccount> {
    let s = state.settings();
    let mut account = GitHubAccount {
        user: None,
        token_source: None,
        token_rejected: false,
        keychain_available: secrets::github_status().keychain_available,
        device_flow: github::client_id(&s.github.client_id).is_some(),
    };
    let Some((t, source)) = secrets::github_token() else {
        return Ok(account);
    };
    account.token_source = Some(source);
    match github::user(&t).await {
        Ok(u) => account.user = Some(u),
        Err(e) if e.kind == ErrorKind::GithubNotSignedIn => account.token_rejected = true,
        Err(e) => return Err(e),
    }
    Ok(account)
}

/// Starts "Sign in with GitHub": returns the code to enter at github.com/login/device.
#[tauri::command]
pub async fn github_device_start(state: State<'_, AppState>) -> AppResult<DeviceCode> {
    let id = github::client_id(&state.settings().github.client_id).ok_or_else(|| {
        AppError::invalid(
            "Sign-in through the browser isn't set up in this version. Use a personal access token instead.",
        )
    })?;
    require_keychain()?;
    let (code, pending) = github::device_start(&id).await?;
    state.set_github_device(Some(pending));
    Ok(code)
}

/// Waits for the user to approve the sign-in on GitHub, then keeps the token in the keychain.
/// Cancel with `op_cancel("github-login")`.
#[tauri::command]
pub async fn github_device_wait(state: State<'_, AppState>) -> AppResult<GitHubUser> {
    let pending = state
        .take_github_device()
        .ok_or_else(|| AppError::invalid("Start signing in again."))?;
    let guard = state.begin_cancellable("github-login".into());
    let t = github::device_wait(pending, &guard.notify).await?;
    drop(guard);
    let user = github::user(&t).await?;
    secrets::github_set(&t)?;
    state.forget_github_token();
    Ok(user)
}

/// Signs in with a personal access token: checked with GitHub first, then kept in the keychain.
#[tauri::command]
pub async fn github_token_set(state: State<'_, AppState>, token: String) -> AppResult<GitHubUser> {
    let t = token.trim();
    if t.is_empty() {
        return Err(AppError::invalid("Paste a personal access token."));
    }
    if t.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::invalid(
            "That doesn't look like a token: it contains spaces or line breaks.",
        ));
    }
    require_keychain()?;
    let user = github::user(t).await.map_err(|e| {
        if e.kind == ErrorKind::GithubNotSignedIn {
            AppError::new(
                ErrorKind::GithubNotSignedIn,
                "GitHub didn't accept this token. Check that you copied all of it and that it hasn't expired.",
            )
        } else {
            e
        }
    })?;
    secrets::github_set(t)?;
    state.forget_github_token();
    Ok(user)
}

/// Removes the saved GitHub sign-in from the keychain (an environment variable stays in effect).
#[tauri::command]
pub fn github_sign_out(state: State<'_, AppState>) -> AppResult<()> {
    secrets::github_clear()?;
    state.forget_github_token();
    Ok(())
}

/// The signed-in user's repositories, for cloning.
#[tauri::command]
pub async fn github_repos() -> AppResult<Vec<GitHubRepo>> {
    github::repos(&token()?).await
}

/// The GitHub repository this repository's remote points at; `None` when no remote is on GitHub.
/// Prefers the current branch's remote, then "origin".
#[tauri::command]
pub async fn github_link(state: State<'_, AppState>, id: i64) -> AppResult<Option<GitHubLink>> {
    repo!(state, id, git, root, r);
    let remotes = r.remotes().await?;
    let gh = github_remotes(&remotes);
    if gh.is_empty() {
        return Ok(None);
    }
    let names: Vec<String> = remotes.iter().map(|r| r.name.clone()).collect();
    let st = r.status().await?;
    let preferred = st
        .branch
        .upstream
        .as_deref()
        .and_then(|u| github::split_upstream(u, &names))
        .map(|(remote, _)| remote.to_string());
    let pick = gh
        .iter()
        .find(|(n, _, _)| Some(n) == preferred.as_ref())
        .or_else(|| gh.iter().find(|(n, _, _)| n == "origin"))
        .unwrap_or(&gh[0]);
    let mut link = github::repo_link(&token()?, &pick.1, &pick.2).await?;
    link.repo.remote = Some(pick.0.clone());
    if let Some(p) = link.parent.as_mut() {
        p.remote = remote_for(&gh, &p.owner, &p.name).map(String::from);
    }
    Ok(Some(link))
}

/// Open pull requests of a GitHub repository.
#[tauri::command]
pub async fn github_pulls(owner: String, name: String) -> AppResult<Vec<PullRequest>> {
    github::pulls(&token()?, &owner, &name).await
}

/// Opens a pull request from the current branch (as pushed) into `base` of `owner/name`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn github_pull_create(
    state: State<'_, AppState>,
    id: i64,
    owner: String,
    name: String,
    base: String,
    title: String,
    body: String,
    draft: bool,
) -> AppResult<CreatedPull> {
    let base = crate::git::validate::ref_name(base.trim())?.to_string();
    repo!(state, id, git, root, r);
    let st = r.status().await?;
    if st.branch.head.is_none() {
        return Err(AppError::invalid(
            "You're not on a branch (detached HEAD). Create a branch first.",
        ));
    }
    let upstream = st.branch.upstream.clone().ok_or_else(|| {
        AppError::new(
            ErrorKind::NoUpstream,
            "This branch isn't on GitHub yet. Push it first, then open the pull request.",
        )
    })?;
    let remotes = r.remotes().await?;
    let names: Vec<String> = remotes.iter().map(|r| r.name.clone()).collect();
    let (remote, branch) = github::split_upstream(&upstream, &names)
        .ok_or_else(|| AppError::invalid("Couldn't tell which remote this branch is pushed to."))?;
    let head_repo = remotes
        .iter()
        .find(|r| r.name == remote)
        .and_then(|r| github::parse_remote_url(&r.fetch_url))
        .ok_or_else(|| {
            AppError::invalid("This branch is pushed to a remote that isn't on GitHub.")
        })?;
    let ahead = st.branch.ahead.unwrap_or(0);
    if ahead > 0 {
        return Err(AppError::invalid(format!(
            "{ahead} commit{} on this branch {} pushed yet. Push first so {} part of the pull request.",
            if ahead == 1 { "" } else { "s" },
            if ahead == 1 { "isn't" } else { "aren't" },
            if ahead == 1 { "it's" } else { "they're" },
        )));
    }
    let head = github::pull_head_param(&owner, &name, (&head_repo.0, &head_repo.1), branch);
    github::create_pull(&token()?, &owner, &name, &head, &base, &title, &body, draft).await
}

/// Checks out pull request `number` of `owner/name` locally (see `git/pulls.rs`).
#[tauri::command]
pub async fn github_pull_checkout(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    owner: String,
    name: String,
    number: u32,
) -> AppResult<PrCheckout> {
    let head = github::pull_head(&token()?, &owner, &name, number).await?;
    let lock = state.repo_lock(id);
    let _g = lock.lock().await;
    repo!(state, id, git, root, r);
    let gh = github_remotes(&r.remotes().await?);
    let remote = remote_for(&gh, &owner, &name);
    let guard = state.begin_cancellable(format!("repo:{id}"));
    let on = progress(&app, Some(id), "fetch");
    match remote {
        Some(remote) if !head.cross_repository => {
            r.checkout_pull_branch(remote, &head.head_ref, Some(&guard.notify), on)
                .await
        }
        _ => {
            let url = format!(
                "https://github.com/{}/{}.git",
                github::valid_name(&owner)?,
                github::valid_name(&name)?
            );
            r.checkout_pull_head(remote.unwrap_or(&url), number, Some(&guard.notify), on)
                .await
        }
    }
}
