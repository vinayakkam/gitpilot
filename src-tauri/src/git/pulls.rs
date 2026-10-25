//! Checking out a GitHub pull request locally.
//!
//! A pull request from the same repository is checked out as its real branch (tracking the
//! remote, so Pull and Push work). One from a fork is fetched from `refs/pull/<n>/head` into a
//! local `pr-<n>` branch. Existing local branches are only ever fast-forwarded: local commits
//! are never thrown away.

use serde::Serialize;
use tokio::sync::Notify;
use ts_rs::TS;

use super::repo::{Repo, NO_EXT};
use super::runner::{RunOpts, NETWORK_TIMEOUT};
use super::validate as v;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrCheckout {
    /// The local branch now checked out.
    pub branch: String,
    /// The branch was created.
    pub created: bool,
    /// An existing branch was fast-forwarded to the pull request.
    pub updated: bool,
    /// An existing branch has commits that aren't in the pull request, so it was left as it was.
    pub diverged: bool,
}

/// Local branch name for a pull request from a fork.
pub fn pull_branch_name(number: u32) -> String {
    format!("pr-{number}")
}

impl Repo<'_> {
    async fn ro_text(&self, args: &[&str], ok: &'static [i32]) -> AppResult<(i32, String)> {
        let out = self
            .git
            .run(
                self.path,
                args,
                RunOpts {
                    ok_codes: ok,
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok((out.code, out.text().trim().to_string()))
    }

    async fn branch_oid(&self, branch: &str) -> AppResult<Option<String>> {
        let r = format!("refs/heads/{branch}");
        let (code, oid) = self
            .ro_text(&["rev-parse", "--verify", "--quiet", &r], &[1])
            .await?;
        Ok((code == 0 && !oid.is_empty()).then_some(oid))
    }

    async fn current_branch(&self) -> AppResult<Option<String>> {
        let (code, name) = self
            .ro_text(&["symbolic-ref", "--short", "-q", "HEAD"], &[1])
            .await?;
        Ok((code == 0 && !name.is_empty()).then_some(name))
    }

    async fn exec(&self, args: &[&str]) -> AppResult<()> {
        self.git.run(self.path, args, RunOpts::default()).await?;
        Ok(())
    }

    async fn fetch_quiet<F: FnMut(String) + Send>(
        &self,
        source: &str,
        refspec: &str,
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<()> {
        let mut args: Vec<&str> = NO_EXT.to_vec();
        args.extend(["fetch", "--progress", "--no-tags", "--", source, refspec]);
        self.git
            .run_streaming(self.path, &args, NETWORK_TIMEOUT, cancel, on)
            .await?;
        Ok(())
    }

    /// Moves an existing local branch to `oid` if that's a fast-forward, then switches to it.
    async fn update_and_switch(
        &self,
        branch: &str,
        local: &str,
        oid: &str,
    ) -> AppResult<PrCheckout> {
        let current = self.current_branch().await?;
        let on_it = current.as_deref() == Some(branch);
        let (mut updated, mut diverged) = (false, false);
        if local != oid {
            let (code, _) = self
                .ro_text(&["merge-base", "--is-ancestor", local, oid], &[1])
                .await?;
            if code == 0 {
                if on_it {
                    self.exec(&["merge", "--ff-only", "--no-edit", oid]).await?;
                } else {
                    let r = format!("refs/heads/{branch}");
                    self.exec(&["update-ref", &r, oid, local]).await?;
                }
                updated = true;
            } else {
                diverged = true;
            }
        }
        if !on_it {
            self.exec(&["switch", "--no-guess", branch]).await?;
        }
        Ok(PrCheckout {
            branch: branch.to_string(),
            created: false,
            updated,
            diverged,
        })
    }

    /// Checks out a pull request whose branch lives in the repository `remote` points at.
    pub async fn checkout_pull_branch<F: FnMut(String) + Send>(
        &self,
        remote: &str,
        branch: &str,
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<PrCheckout> {
        let remote = v::remote_name(remote)?;
        let branch = v::ref_name(branch)?;
        let tracking = format!("refs/remotes/{remote}/{branch}");
        self.fetch_quiet(
            remote,
            &format!("+refs/heads/{branch}:{tracking}"),
            cancel,
            on,
        )
        .await?;
        let (_, oid) = self
            .ro_text(
                &["rev-parse", "--verify", &format!("{tracking}^{{commit}}")],
                &[],
            )
            .await?;
        match self.branch_oid(branch).await? {
            Some(local) => self.update_and_switch(branch, &local, &oid).await,
            None => {
                self.branch_checkout_remote(&format!("{remote}/{branch}"), branch)
                    .await?;
                Ok(PrCheckout {
                    branch: branch.to_string(),
                    created: true,
                    updated: false,
                    diverged: false,
                })
            }
        }
    }

    /// Checks out pull request `number` from `source` (a remote name, or an https URL of the
    /// repository it was opened in) as the local branch `pr-<number>`.
    pub async fn checkout_pull_head<F: FnMut(String) + Send>(
        &self,
        source: &str,
        number: u32,
        cancel: Option<&Notify>,
        on: F,
    ) -> AppResult<PrCheckout> {
        let source = if source.starts_with("https://") {
            v::remote_url(source)?
        } else {
            v::remote_name(source)?
        };
        self.fetch_quiet(source, &format!("refs/pull/{number}/head"), cancel, on)
            .await?;
        let (_, oid) = self
            .ro_text(&["rev-parse", "--verify", "FETCH_HEAD^{commit}"], &[])
            .await?;
        let branch = pull_branch_name(number);
        match self.branch_oid(&branch).await? {
            Some(local) => self.update_and_switch(&branch, &local, &oid).await,
            None => {
                self.exec(&["switch", "--no-track", "-c", &branch, &oid])
                    .await?;
                Ok(PrCheckout {
                    branch,
                    created: true,
                    updated: false,
                    diverged: false,
                })
            }
        }
    }
}
