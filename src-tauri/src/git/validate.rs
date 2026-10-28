//! Backend-side validation of every value that reaches a git argument vector.
//! Frontend validation is a convenience; this is the enforcement point.

use std::path::{Component, Path};

use crate::error::{AppError, AppResult};

/// A path inside the repository, relative, with no `..` and no option-looking prefix.
pub fn rel_path(p: &str) -> AppResult<&str> {
    if p.is_empty() || p.contains('\0') {
        return Err(AppError::invalid("Invalid file path."));
    }
    let path = Path::new(p);
    if path.is_absolute()
        || p.starts_with('/')
        || p.starts_with('\\')
        || p.contains(':') && cfg!(windows)
    {
        return Err(AppError::invalid(
            "File paths must be relative to the repository.",
        ));
    }
    for c in path.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::invalid(
                    "File paths may not leave the repository.",
                ))
            }
            _ => {}
        }
    }
    Ok(p)
}

pub fn rel_paths(ps: &[String]) -> AppResult<Vec<&str>> {
    if ps.is_empty() {
        return Err(AppError::invalid("No files were selected."));
    }
    ps.iter().map(|p| rel_path(p)).collect()
}

/// A ref/branch name. Further checked by `git check-ref-format` where it matters.
pub fn ref_name(name: &str) -> AppResult<&str> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::invalid("Name can't be empty."));
    }
    if n.starts_with('-') {
        return Err(AppError::invalid("Names can't start with a dash."));
    }
    if n.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::invalid(
            "Names can't contain spaces or control characters.",
        ));
    }
    if n.contains("..")
        || n.contains("@{")
        || n.ends_with(".lock")
        || n.ends_with('/')
        || n.ends_with('.')
    {
        return Err(AppError::invalid("That isn't a valid Git name."));
    }
    if n.chars()
        .any(|c| matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\'))
    {
        return Err(AppError::invalid("Names can't contain ~ ^ : ? * [ or \\."));
    }
    Ok(n)
}

/// A revision for read commands (hash, branch, `HEAD~2`). Only blocks option injection.
pub fn revision(rev: &str) -> AppResult<&str> {
    let r = rev.trim();
    if r.is_empty() || r.starts_with('-') || r.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(AppError::invalid("Invalid revision."));
    }
    Ok(r)
}

pub fn commit_hash(h: &str) -> AppResult<&str> {
    let h = h.trim();
    if h.len() < 4 || h.len() > 64 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::invalid("Invalid commit id."));
    }
    Ok(h)
}

/// A calendar day as YYYY-MM-DD (what `<input type="date">` sends).
pub fn date(d: &str) -> AppResult<&str> {
    let d = d.trim();
    let ok = d.len() == 10
        && d.char_indices().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        })
        && (1..=12).contains(&d[5..7].parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&d[8..10].parse::<u8>().unwrap_or(0));
    if !ok {
        return Err(AppError::invalid("Enter the date as YYYY-MM-DD."));
    }
    Ok(d)
}

pub fn remote_name(name: &str) -> AppResult<&str> {
    let n = name.trim();
    if n.is_empty()
        || n.starts_with('-')
        || !n
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
        || n.contains("..")
    {
        return Err(AppError::invalid(
            "Remote names may use letters, numbers, '.', '_', '-' and '/'.",
        ));
    }
    Ok(n)
}

/// Remote URL: allows https, http, ssh, git, file, scp-like `user@host:path`, and local paths.
/// Blocks option injection and command-executing transports (`ext::`, `fd::`).
pub fn remote_url(url: &str) -> AppResult<&str> {
    let u = url.trim();
    if u.is_empty() {
        return Err(AppError::invalid("Enter a repository URL."));
    }
    if u.starts_with('-') || u.chars().any(|c| c.is_control()) {
        return Err(AppError::invalid("That URL isn't valid."));
    }
    let lower = u.to_ascii_lowercase();
    if lower.starts_with("ext::")
        || lower.starts_with("fd::")
        || lower.contains("::") && !lower.contains("://")
    {
        return Err(AppError::invalid(
            "Remote helpers that run commands (like ext::) aren't allowed.",
        ));
    }
    Ok(u)
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates() {
        assert_eq!(super::date(" 2026-10-28 ").unwrap(), "2026-10-28");
        for bad in [
            "2026-13-01",
            "2026-1-01",
            "26-10-28",
            "2026/10/28",
            "2026-10-00",
            "--since",
        ] {
            assert!(super::date(bad).is_err(), "{bad}");
        }
    }

    use super::*;

    #[test]
    fn path_rules() {
        assert!(rel_path("src/a b.rs").is_ok());
        assert!(rel_path("../etc/passwd").is_err());
        assert!(rel_path("a/../../b").is_err());
        assert!(rel_path("/etc/passwd").is_err());
        assert!(rel_path("").is_err());
        assert!(
            rel_path("-rf").is_ok(),
            "dash paths are fine because they always follow --"
        );
    }

    #[test]
    fn ref_rules() {
        assert!(ref_name("feature/login").is_ok());
        assert!(ref_name("--force").is_err());
        assert!(ref_name("a..b").is_err());
        assert!(ref_name("has space").is_err());
        assert!(revision("HEAD~2").is_ok());
        assert!(revision("--output=x").is_err());
    }

    #[test]
    fn url_rules() {
        assert!(remote_url("https://github.com/o/r.git").is_ok());
        assert!(remote_url("git@gitlab.com:o/r.git").is_ok());
        assert!(remote_url("ssh://git@h:2222/r").is_ok());
        assert!(remote_url("ext::sh -c touch% /tmp/pwned").is_err());
        assert!(remote_url("--upload-pack=evil").is_err());
    }
}
