//! Keys that can sign commits: SSH public keys in `~/.ssh`, and GPG secret keys from
//! `gpg --list-secret-keys`. Nothing is created or changed here.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use ts_rs::TS;

use crate::cli;
use crate::git::signing::SigningFormat;

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SigningKey {
    pub format: SigningFormat,
    /// What goes into `user.signingkey`: the SSH private key path (or the public key path when
    /// only the public half is on disk, e.g. a hardware or agent key), or the GPG key id.
    pub value: String,
    /// e.g. "ssh-ed25519 · me@laptop" or "Ann <ann@example.com>".
    pub label: String,
    /// GPG: the key has expired.
    pub expired: bool,
}

/// Parses one `.pub` file's contents.
pub fn parse_ssh_public(content: &str) -> Option<(String, String)> {
    let mut parts = content.split_whitespace();
    let kind = parts.next()?;
    let known = kind.starts_with("ssh-") || kind.starts_with("ecdsa-") || kind.starts_with("sk-");
    parts.next()?;
    known.then(|| (kind.to_string(), parts.collect::<Vec<_>>().join(" ")))
}

/// SSH public keys in `dir` (normally `~/.ssh`).
pub fn ssh_keys_in(dir: &Path) -> Vec<SigningKey> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<SigningKey> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "pub") && p.is_file())
        .filter_map(|pub_path| {
            let content = std::fs::read_to_string(&pub_path).ok()?;
            let (kind, comment) = parse_ssh_public(&content)?;
            let private = pub_path.with_extension("");
            let value = if private.is_file() {
                private
            } else {
                pub_path.clone()
            };
            let file = pub_path.file_name()?.to_string_lossy().into_owned();
            Some(SigningKey {
                format: SigningFormat::Ssh,
                value: value.display().to_string(),
                label: if comment.is_empty() {
                    format!("{file} · {kind}")
                } else {
                    format!("{file} · {kind} · {comment}")
                },
                expired: false,
            })
        })
        .collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// Parses `gpg --list-secret-keys --with-colons` into signing-capable keys.
pub fn parse_gpg_colons(raw: &str) -> Vec<SigningKey> {
    let mut out: Vec<SigningKey> = Vec::new();
    // (key id, expired, can sign), then the first uid that follows.
    let mut current: Option<(String, bool, bool)> = None;
    let mut labelled = false;
    for line in raw.lines() {
        let f: Vec<&str> = line.split(':').collect();
        match f.first().copied() {
            Some("sec") => {
                let id = f.get(4).copied().unwrap_or("").to_string();
                let expired = matches!(f.get(1).copied(), Some("e" | "r"));
                let caps = f.get(11).copied().unwrap_or("");
                current = Some((id, expired, caps.contains('s') || caps.contains('S')));
                labelled = false;
            }
            Some("uid") if !labelled => {
                if let Some((id, expired, sign)) = &current {
                    if *sign && !id.is_empty() {
                        out.push(SigningKey {
                            format: SigningFormat::Gpg,
                            value: id.clone(),
                            label: format!(
                                "{} · {id}",
                                f.get(9).copied().unwrap_or("").replace("\\x3a", ":")
                            ),
                            expired: *expired,
                        });
                    }
                    labelled = true;
                }
            }
            _ => {}
        }
    }
    out
}

/// gpg on PATH, or the copy bundled with Git for Windows.
fn find_gpg(git_exe: &Path) -> Option<PathBuf> {
    if let Ok(p) = which::which("gpg") {
        return Some(p);
    }
    // C:\Program Files\Git\cmd\git.exe → C:\Program Files\Git\usr\bin\gpg.exe
    let root = git_exe.parent()?.parent()?;
    let bundled = root
        .join("usr")
        .join("bin")
        .join(if cfg!(windows) { "gpg.exe" } else { "gpg" });
    bundled.is_file().then_some(bundled)
}

async fn gpg_keys(git_exe: &Path) -> Vec<SigningKey> {
    let Some(gpg) = find_gpg(git_exe) else {
        return Vec::new();
    };
    let mut cmd = tokio::process::Command::new(gpg);
    cmd.args(["--batch", "--list-secret-keys", "--with-colons"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    match tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => parse_gpg_colons(&String::from_utf8_lossy(&o.stdout)),
        _ => Vec::new(),
    }
}

/// SSH keys first, then GPG keys.
pub async fn list(git_exe: &Path) -> Vec<SigningKey> {
    let mut keys = cli::home()
        .map(|h| ssh_keys_in(&h.join(".ssh")))
        .unwrap_or_default();
    keys.extend(gpg_keys(git_exe).await);
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ssh_keys() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("id_ed25519.pub"),
            "ssh-ed25519 AAAAC3 me@laptop\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("id_ed25519"), "private").unwrap();
        std::fs::write(
            dir.path().join("yubikey.pub"),
            "sk-ssh-ed25519@openssh.com AAAAGn\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("notes.pub"), "not a key").unwrap();
        std::fs::write(dir.path().join("known_hosts"), "x").unwrap();
        let keys = ssh_keys_in(dir.path());
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].label, "id_ed25519.pub · ssh-ed25519 · me@laptop");
        assert_eq!(
            keys[0].value,
            dir.path().join("id_ed25519").display().to_string()
        );
        // Only the public half on disk (hardware key): sign with the public key path.
        assert!(keys[1].value.ends_with("yubikey.pub"));
        assert!(ssh_keys_in(&dir.path().join("missing")).is_empty());
    }

    #[test]
    fn reads_gpg_colon_output() {
        let raw = "sec:u:255:22:ABCDEF0123456789:1700000000:::u:::scESC:::+:::23::0:\n\
fpr:::::::::0123456789ABCDEF0123ABCDEF0123456789:\n\
uid:u::::1700000000::HASH::Ann Example <ann@example.com>::::::::::0:\n\
uid:u::::1700000000::HASH::Ann Work <ann@work.example>::::::::::0:\n\
ssb:u:255:18:1111222233334444:1700000000::::::e:::+:::23:\n\
sec:e:255:22:FEDCBA9876543210:1600000000:1650000000::u:::sc:::+:::23::0:\n\
uid:e::::1600000000::HASH::Old Key <old\\x3aname@example.com>::::::::::0:\n\
sec:u:255:22:0000111122223333:1700000000:::u:::e:::+:::23::0:\n\
uid:u::::1700000000::HASH::Encrypt Only <enc@example.com>::::::::::0:\n";
        let keys = parse_gpg_colons(raw);
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].value, "ABCDEF0123456789");
        assert_eq!(
            keys[0].label,
            "Ann Example <ann@example.com> · ABCDEF0123456789"
        );
        assert!(!keys[0].expired);
        assert!(keys[1].expired);
        assert!(keys[1].label.starts_with("Old Key <old:name@example.com>"));
    }
}
