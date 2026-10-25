//! Commit signing: reading and changing the signing setup (GPG or SSH), the allowed-signers
//! file that lets Git verify SSH signatures, and a commit's signature status.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::repo::Repo;
use super::runner::{Git, RunOpts};
use super::validate as v;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SigningScope {
    /// Your global Git configuration: every repository.
    Global,
    /// This repository only (`.git/config`).
    Repository,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SigningFormat {
    Gpg,
    Ssh,
    X509,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SigningConfig {
    /// Commits are signed (`commit.gpgsign`).
    pub enabled: bool,
    /// Where `commit.gpgsign` comes from; `None` when it isn't set anywhere.
    pub scope: Option<SigningScope>,
    pub format: SigningFormat,
    /// `user.signingkey`: a GPG key id, or an SSH key path / literal key.
    pub key: Option<String>,
    /// `gpg.ssh.allowedSignersFile`, needed to verify SSH signatures.
    pub allowed_signers: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SignatureStatus {
    /// Good signature from a trusted / allowed key.
    Verified,
    /// Good signature, but the key's owner isn't confirmed (unknown validity).
    Unverified,
    Bad,
    /// The signature or the key has expired.
    Expired,
    Revoked,
    /// Signed, but this computer can't check it (no gpg, unknown key, no allowed signers).
    CannotCheck,
    NotSigned,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Signature {
    pub status: SignatureStatus,
    pub signer: Option<String>,
    pub key: Option<String>,
}

/// Maps `%G?` (see `git help log`).
pub fn signature_status(code: &str) -> SignatureStatus {
    match code.trim() {
        "G" => SignatureStatus::Verified,
        "U" => SignatureStatus::Unverified,
        "B" => SignatureStatus::Bad,
        "X" | "Y" => SignatureStatus::Expired,
        "R" => SignatureStatus::Revoked,
        "E" => SignatureStatus::CannotCheck,
        _ => SignatureStatus::NotSigned,
    }
}

/// Parses `%G?%x1f%GS%x1f%GK`.
pub fn parse_signature(raw: &str) -> Signature {
    let mut f = raw.trim_end_matches('\n').split('\x1f');
    let status = signature_status(f.next().unwrap_or(""));
    let some = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let signer = some(f.next());
    let key = some(f.next());
    Signature {
        status,
        signer,
        key,
    }
}

fn format_from(v: Option<&str>) -> SigningFormat {
    match v.map(str::trim) {
        Some("ssh") => SigningFormat::Ssh,
        Some("x509") => SigningFormat::X509,
        _ => SigningFormat::Gpg,
    }
}

/// `true`, `yes`, `on` and `1` are true in Git configuration.
fn truthy(v: Option<&str>) -> bool {
    matches!(
        v.map(|s| s.trim().to_ascii_lowercase()).as_deref(),
        Some("true" | "yes" | "on" | "1")
    )
}

/// One `--show-scope` line ("global\ttrue") as (scope, value).
fn scoped(line: &str) -> Option<(Option<SigningScope>, String)> {
    let (scope, value) = line.split_once('\t')?;
    let scope = match scope {
        "global" => Some(SigningScope::Global),
        "local" | "worktree" => Some(SigningScope::Repository),
        _ => None,
    };
    Some((scope, value.to_string()))
}

/// Reads the signing setup as Git sees it from `cwd` (a repository, or any folder for global only).
async fn read_config(git: &Git, cwd: &Path, global_only: bool) -> AppResult<SigningConfig> {
    let get = |key: &'static str| async move {
        let mut args = vec!["config"];
        if global_only {
            args.push("--global");
        }
        args.extend(["--show-scope", "--get", key]);
        let out = git
            .run(
                cwd,
                &args,
                RunOpts {
                    ok_codes: &[1],
                    read_only: true,
                    ..RunOpts::default()
                },
            )
            .await?;
        Ok::<_, AppError>(scoped(out.text().trim()))
    };
    let sign = get("commit.gpgsign").await?;
    let format = get("gpg.format").await?;
    let key = get("user.signingkey").await?;
    let allowed = get("gpg.ssh.allowedSignersFile").await?;
    Ok(SigningConfig {
        enabled: truthy(sign.as_ref().map(|(_, v)| v.as_str())),
        scope: sign.and_then(|(s, _)| s),
        format: format_from(format.as_ref().map(|(_, v)| v.as_str())),
        key: key.map(|(_, v)| v).filter(|k| !k.is_empty()),
        allowed_signers: allowed.map(|(_, v)| v).filter(|k| !k.is_empty()),
    })
}

/// The global signing setup (no repository needed).
pub async fn global_config(git: &Git) -> AppResult<SigningConfig> {
    read_config(git, &std::env::temp_dir(), true).await
}

/// Checks a key value before it goes into the configuration.
pub fn check_key(format: SigningFormat, key: &str) -> AppResult<String> {
    let k = key.trim();
    match format {
        SigningFormat::Gpg => {
            let hex = k.strip_prefix("0x").unwrap_or(k);
            if (8..=40).contains(&hex.len()) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                Ok(hex.to_ascii_uppercase())
            } else {
                Err(AppError::invalid("Choose a GPG key from the list."))
            }
        }
        SigningFormat::Ssh => {
            let p = Path::new(k);
            if !p.is_absolute() || !p.is_file() || k.starts_with('-') {
                return Err(AppError::invalid("Choose an SSH key from the list."));
            }
            Ok(k.to_string())
        }
        SigningFormat::X509 => Err(AppError::invalid(
            "GitPilot sets up GPG and SSH signing. Set up X.509 signing with Git directly.",
        )),
    }
}

/// Writes `entries` to `scope` (`--global` from a neutral folder, or `--local` in the repository).
async fn write_config(
    git: &Git,
    repo: Option<&Path>,
    scope: SigningScope,
    set: &[(&str, &str)],
    unset: &[&str],
) -> AppResult<()> {
    let (cwd, flag) = match (scope, repo) {
        (SigningScope::Global, _) => (std::env::temp_dir(), "--global"),
        (SigningScope::Repository, Some(r)) => (r.to_path_buf(), "--local"),
        (SigningScope::Repository, None) => {
            return Err(AppError::invalid(
                "Open a repository to change its own settings.",
            ))
        }
    };
    for (k, v) in set {
        git.run(&cwd, ["config", flag, k, v], RunOpts::default())
            .await?;
    }
    for k in unset {
        // Exit code 5: the key wasn't set, which is fine.
        git.run(
            &cwd,
            ["config", flag, "--unset", k],
            RunOpts {
                ok_codes: &[5],
                ..RunOpts::default()
            },
        )
        .await?;
    }
    Ok(())
}

/// Turns signing on with `key`. For SSH keys, also makes sure Git can verify the signatures:
/// the key is added to `allowed_signers_file` (GitPilot's own file) unless the user already
/// configured a different allowed-signers file, which is never replaced.
pub async fn enable(
    git: &Git,
    repo: Option<&Path>,
    scope: SigningScope,
    format: SigningFormat,
    key: &str,
    allowed_signers_file: &Path,
) -> AppResult<()> {
    let key = check_key(format, key)?;
    let fmt = match format {
        SigningFormat::Ssh => "ssh",
        _ => "openpgp",
    };
    write_config(
        git,
        repo,
        scope,
        &[
            ("gpg.format", fmt),
            ("user.signingkey", &key),
            ("commit.gpgsign", "true"),
            ("tag.gpgsign", "true"),
        ],
        &[],
    )
    .await?;
    if format == SigningFormat::Ssh {
        let current = match repo {
            Some(r) => read_config(git, r, false).await?,
            None => global_config(git).await?,
        };
        let ours = allowed_signers_file.display().to_string();
        if current
            .allowed_signers
            .as_deref()
            .is_some_and(|f| f != ours)
        {
            return Ok(());
        }
        let email = identity_email(git, repo).await?.ok_or_else(|| {
            AppError::invalid("Set your name and email (Settings → Git) before turning on SSH signing, so signatures can be matched to you.")
        })?;
        let public = std::fs::read_to_string(public_key_path(&key))?;
        add_allowed_signer(allowed_signers_file, &email, public.trim())?;
        write_config(
            git,
            repo,
            scope,
            &[("gpg.ssh.allowedSignersFile", &ours)],
            &[],
        )
        .await?;
    }
    Ok(())
}

/// Turns signing off in `scope` (removes the settings GitPilot writes; keys are kept).
pub async fn disable(git: &Git, repo: Option<&Path>, scope: SigningScope) -> AppResult<()> {
    write_config(git, repo, scope, &[], &["commit.gpgsign", "tag.gpgsign"]).await
}

async fn identity_email(git: &Git, repo: Option<&Path>) -> AppResult<Option<String>> {
    let cwd = repo
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let out = git
        .run(
            &cwd,
            ["config", "--get", "user.email"],
            RunOpts {
                ok_codes: &[1],
                read_only: true,
                ..RunOpts::default()
            },
        )
        .await?;
    Ok(Some(out.text().trim().to_string()).filter(|s| !s.is_empty()))
}

/// The `.pub` file for an SSH signing key given as a private or public key path.
pub fn public_key_path(key: &str) -> String {
    if key.ends_with(".pub") {
        key.to_string()
    } else {
        format!("{key}.pub")
    }
}

/// Adds `email key` to an allowed-signers file, once.
pub fn add_allowed_signer(file: &Path, email: &str, public_key: &str) -> AppResult<()> {
    if email.chars().any(char::is_whitespace) || public_key.contains('\n') {
        return Err(AppError::invalid(
            "That key or email can't be used for signing.",
        ));
    }
    // "ssh-ed25519 AAAA… comment" → keep type and key, drop the comment.
    let mut parts = public_key.split_whitespace();
    let (Some(kind), Some(body)) = (parts.next(), parts.next()) else {
        return Err(AppError::invalid(
            "That doesn't look like an SSH public key.",
        ));
    };
    let line = format!("{email} {kind} {body}");
    let existing = std::fs::read_to_string(file).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == line) {
        return Ok(());
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&line);
    out.push('\n');
    std::fs::write(file, out)?;
    Ok(())
}

impl Repo<'_> {
    /// The signing setup in effect for this repository.
    pub async fn signing_config(&self) -> AppResult<SigningConfig> {
        read_config(self.git, self.path, false).await
    }

    /// Who signed a commit, and whether the signature checks out.
    pub async fn signature(&self, hash: &str) -> AppResult<Signature> {
        let hash = v::commit_hash(hash)?;
        let raw = self
            .git
            .read(
                self.path,
                ["log", "-1", "--format=%G?%x1f%GS%x1f%GK", hash, "--"],
            )
            .await?;
        Ok(parse_signature(&raw))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_signature_codes() {
        let s = parse_signature("G\x1fAnn <ann@example.com>\x1fSHA256:abc\n");
        assert_eq!(s.status, SignatureStatus::Verified);
        assert_eq!(s.signer.as_deref(), Some("Ann <ann@example.com>"));
        assert_eq!(s.key.as_deref(), Some("SHA256:abc"));
        assert_eq!(
            parse_signature("N\x1f\x1f\n").status,
            SignatureStatus::NotSigned
        );
        assert_eq!(parse_signature("N\x1f\x1f\n").signer, None);
        for (c, want) in [
            ("U", SignatureStatus::Unverified),
            ("B", SignatureStatus::Bad),
            ("X", SignatureStatus::Expired),
            ("Y", SignatureStatus::Expired),
            ("R", SignatureStatus::Revoked),
            ("E", SignatureStatus::CannotCheck),
        ] {
            assert_eq!(signature_status(c), want);
        }
    }

    #[test]
    fn reads_scoped_values() {
        assert_eq!(
            scoped("global\ttrue"),
            Some((Some(SigningScope::Global), "true".into()))
        );
        assert_eq!(
            scoped("local\tssh"),
            Some((Some(SigningScope::Repository), "ssh".into()))
        );
        assert_eq!(scoped("system\ttrue"), Some((None, "true".into())));
        assert_eq!(scoped(""), None);
        assert!(
            truthy(Some("Yes")) && truthy(Some("1")) && !truthy(Some("false")) && !truthy(None)
        );
    }

    #[test]
    fn checks_keys() {
        assert_eq!(
            check_key(SigningFormat::Gpg, "0xabcdef0123456789").unwrap(),
            "ABCDEF0123456789"
        );
        assert!(check_key(SigningFormat::Gpg, "nope").is_err());
        assert!(check_key(SigningFormat::Ssh, "relative/key").is_err());
        assert!(check_key(SigningFormat::Ssh, "/definitely/missing/key").is_err());
        assert!(check_key(SigningFormat::X509, "x").is_err());
        assert_eq!(
            public_key_path("/h/.ssh/id_ed25519"),
            "/h/.ssh/id_ed25519.pub"
        );
        assert_eq!(
            public_key_path("/h/.ssh/id_ed25519.pub"),
            "/h/.ssh/id_ed25519.pub"
        );
    }

    #[test]
    fn allowed_signers_are_added_once() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("sub").join("allowed_signers");
        add_allowed_signer(&f, "me@example.com", "ssh-ed25519 AAAAkey me@laptop").unwrap();
        add_allowed_signer(&f, "me@example.com", "ssh-ed25519 AAAAkey other comment").unwrap();
        assert_eq!(
            std::fs::read_to_string(&f).unwrap(),
            "me@example.com ssh-ed25519 AAAAkey\n"
        );
        assert!(add_allowed_signer(&f, "a b", "ssh-ed25519 K").is_err());
        assert!(add_allowed_signer(&f, "me@example.com", "garbage").is_err());
    }
}
