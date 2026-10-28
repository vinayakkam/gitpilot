//! Removes credentials from URLs and free text before it is shown or logged.

use once_cell::sync::Lazy;
use regex::Regex;

static URL_USERINFO: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b([a-z][a-z0-9+.\-]*://)([^/\s@]+)@").expect("valid regex"));

/// `Authorization: Basic …` / `Bearer …` values, e.g. the GitHub header in GIT_TRACE output.
static AUTH_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(authorization:\s*(?:basic|bearer|token)\s+)[A-Za-z0-9+/=._\-]+")
        .expect("valid regex")
});

/// Redacts `user:password@` / `token@` in any URL contained in `text`, and authorization
/// header values. A bare username without a password (e.g. `ssh://git@host`) is kept because
/// it is not secret.
pub fn redact_text(text: &str) -> String {
    let text = AUTH_HEADER.replace_all(text, "${1}***");
    URL_USERINFO
        .replace_all(&text, |caps: &regex::Captures| {
            let scheme = &caps[1];
            let info = &caps[2];
            if info.contains(':') {
                let user = info.split(':').next().unwrap_or("");
                format!("{scheme}{user}:***@")
            } else if scheme.to_ascii_lowercase().starts_with("http") {
                // https://TOKEN@host is a common way to embed a token.
                format!("{scheme}***@")
            } else {
                format!("{scheme}{info}@")
            }
        })
        .into_owned()
}

/// True when a URL carries an embedded secret.
pub fn has_credentials(url: &str) -> bool {
    redact_text(url) != url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_password() {
        assert_eq!(
            redact_text("fatal: https://bob:hunter2@example.com/r.git failed"),
            "fatal: https://bob:***@example.com/r.git failed"
        );
    }

    #[test]
    fn redacts_authorization_headers() {
        assert_eq!(
            redact_text("> Authorization: Basic eC1hY2Nlc3M6dG9r=\n< 200"),
            "> Authorization: Basic ***\n< 200"
        );
        assert_eq!(
            redact_text("authorization: bearer ghp_x.y-z"),
            "authorization: bearer ***"
        );
    }

    #[test]
    fn redacts_https_token() {
        assert_eq!(
            redact_text("https://ghp_abc123@github.com/o/r"),
            "https://***@github.com/o/r"
        );
    }

    #[test]
    fn keeps_ssh_user() {
        let s = "ssh://git@gitlab.com/o/r.git";
        assert_eq!(redact_text(s), s);
        assert!(!has_credentials(s));
        assert_eq!(
            redact_text("git@github.com:o/r.git"),
            "git@github.com:o/r.git"
        );
    }
}
