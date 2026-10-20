//! Optional AI commit-message suggestions. Only the staged diff is sent, minus sensitive files.

use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::settings::{AiProviderKind, AiSettings, CommitConvention};

/// Maximum diff characters sent to a provider.
pub const MAX_PROMPT_DIFF_CHARS: usize = 48_000;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Suggestion {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSuggestions {
    pub suggestions: Vec<Suggestion>,
    /// Files left out of the request because they may contain secrets.
    pub excluded_files: Vec<String>,
    /// The diff was shortened to fit the request size limit.
    pub truncated: bool,
    pub model: String,
}

/// Files never sent to an external provider.
pub fn is_sensitive(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.ends_with(".pfx")
        || name.ends_with(".keystore")
        || name.ends_with(".jks")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
        || name == ".npmrc"
        || name == ".pypirc"
        || name == ".netrc"
        || name == "credentials"
        || name.contains("secret")
}

pub struct PreparedDiff {
    pub text: String,
    pub excluded: Vec<String>,
    pub truncated: bool,
    pub files: usize,
}

/// Splits a multi-file diff, drops sensitive files and caps the size.
pub fn prepare_diff(raw: &str) -> PreparedDiff {
    let mut text = String::new();
    let mut excluded = Vec::new();
    let mut truncated = false;
    let mut files = 0;
    for chunk in raw.split("diff --git ").filter(|c| !c.trim().is_empty()) {
        let header = chunk.lines().next().unwrap_or("");
        // "a/x b/x" — take the b/ side.
        let path = header
            .rsplit_once(" b/")
            .map(|(_, p)| p.trim().to_string())
            .unwrap_or_else(|| header.to_string());
        if is_sensitive(&path) {
            excluded.push(path);
            continue;
        }
        files += 1;
        let block = format!("diff --git {chunk}");
        if text.len() + block.len() > MAX_PROMPT_DIFF_CHARS {
            let room = MAX_PROMPT_DIFF_CHARS.saturating_sub(text.len());
            let mut cut = room.min(block.len());
            while !block.is_char_boundary(cut) {
                cut -= 1;
            }
            text.push_str(&block[..cut]);
            text.push_str("\n[diff truncated]\n");
            truncated = true;
            break;
        }
        text.push_str(&block);
    }
    PreparedDiff {
        text,
        excluded,
        truncated,
        files,
    }
}

pub fn system_prompt(convention: CommitConvention, include_body: bool) -> String {
    let style = match convention {
        CommitConvention::Conventional => "Use Conventional Commits: `type(optional scope): summary` where type is one of feat, fix, refactor, docs, test, chore, perf, build, ci, style. Choose the type that matches the change.",
        CommitConvention::None => "Write a plain imperative subject line (e.g. \"Add repository switcher\"). Do not use a type prefix.",
    };
    let body = if include_body {
        "Add a short body (1-3 lines, wrapped at 72 chars) explaining what changed and why, only when it adds information. Otherwise use an empty string."
    } else {
        "Leave the body as an empty string."
    };
    format!(
        "You write git commit messages for staged changes.\n\
Rules:\n\
- Describe only what the diff actually shows. Never invent changes.\n\
- Subject: imperative mood, at most 72 characters, no trailing period.\n\
- Be specific; avoid vague words like \"update\", \"fix stuff\", \"changes\".\n\
- {style}\n\
- {body}\n\
- Offer up to 3 distinct alternatives (different focus or wording).\n\
Respond with JSON only, no prose, in exactly this shape:\n\
{{\"suggestions\":[{{\"subject\":\"...\",\"body\":\"...\"}}]}}"
    )
}

/// Extracts suggestions from a model reply. Returns an error rather than inventing anything.
pub fn parse_reply(text: &str) -> AppResult<Vec<Suggestion>> {
    #[derive(Deserialize)]
    struct Reply {
        suggestions: Vec<Suggestion>,
    }
    let start = text.find('{');
    let end = text.rfind('}');
    let (Some(s), Some(e)) = (start, end) else {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "The AI response wasn't in the expected format.",
        )
        .with_detail(text.chars().take(500).collect::<String>()));
    };
    let reply: Reply = serde_json::from_str(&text[s..=e]).map_err(|err| {
        AppError::new(
            ErrorKind::AiFailed,
            "The AI response wasn't in the expected format.",
        )
        .with_detail(err.to_string())
    })?;
    let out: Vec<Suggestion> = reply
        .suggestions
        .into_iter()
        .map(|s| Suggestion {
            subject: s.subject.trim().trim_end_matches('.').to_string(),
            body: s.body.trim().to_string(),
        })
        .filter(|s| !s.subject.is_empty())
        .take(3)
        .collect();
    if out.is_empty() {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "The AI didn't return any usable suggestions.",
        ));
    }
    Ok(out)
}

pub async fn suggest(
    cfg: &AiSettings,
    convention: CommitConvention,
    api_key: Option<String>,
    raw_diff: &str,
) -> AppResult<AiSuggestions> {
    if !cfg.enabled {
        return Err(AppError::new(
            ErrorKind::AiNotConfigured,
            "AI suggestions are turned off. Enable them in Settings → AI.",
        ));
    }
    let prepared = prepare_diff(raw_diff);
    if prepared.files == 0 {
        return Err(AppError::invalid(if prepared.excluded.is_empty() {
            "Stage some changes first — suggestions are based on staged changes only."
        } else {
            "All staged files look sensitive (keys, .env files…), so nothing was sent."
        }));
    }
    let system = system_prompt(convention, cfg.include_body);
    let user = format!("Staged diff:\n\n{}", prepared.text);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| {
            AppError::internal("Couldn't create an HTTP client.").with_detail(e.to_string())
        })?;

    let text = match cfg.provider {
        AiProviderKind::Anthropic => {
            let key = api_key.ok_or_else(|| {
                AppError::new(
                    ErrorKind::AiNotConfigured,
                    "Add an Anthropic API key in Settings → AI.",
                )
            })?;
            let base = if cfg.base_url.trim().is_empty() {
                "https://api.anthropic.com"
            } else {
                cfg.base_url.trim().trim_end_matches('/')
            };
            let resp = client
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": cfg.model.trim(),
                    "max_tokens": 800,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                }))
                .send()
                .await
                .map_err(network_err)?;
            let body: serde_json::Value = check(resp).await?;
            body["content"]
                .as_array()
                .and_then(|a| a.iter().find_map(|b| b["text"].as_str()))
                .unwrap_or_default()
                .to_string()
        }
        AiProviderKind::OpenAiCompatible => {
            let base = cfg.base_url.trim().trim_end_matches('/');
            let mut req = client
                .post(format!("{base}/chat/completions"))
                .json(&json!({
                    "model": cfg.model.trim(),
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                }));
            if let Some(k) = api_key {
                req = req.bearer_auth(k);
            }
            let body: serde_json::Value = check(req.send().await.map_err(network_err)?).await?;
            body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        }
    };

    Ok(AiSuggestions {
        suggestions: parse_reply(&text)?,
        excluded_files: prepared.excluded,
        truncated: prepared.truncated,
        model: cfg.model.trim().to_string(),
    })
}

fn network_err(e: reqwest::Error) -> AppError {
    AppError::new(
        ErrorKind::AiFailed,
        "Couldn't reach the AI provider. Check your connection and the provider URL.",
    )
    .with_detail(e.to_string())
}

async fn check(resp: reqwest::Response) -> AppResult<serde_json::Value> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        return serde_json::from_str(&body).map_err(|e| {
            AppError::new(
                ErrorKind::AiFailed,
                "The AI provider sent an unreadable response.",
            )
            .with_detail(e.to_string())
        });
    }
    let message = match status.as_u16() {
        401 | 403 => "The AI provider rejected the API key. Check it in Settings → AI.",
        404 => {
            "The AI provider couldn't find that model or URL. Check the model name and base URL."
        }
        429 => "The AI provider is rate-limiting requests. Try again shortly.",
        500..=599 => "The AI provider had a server error. Try again later.",
        _ => "The AI provider returned an error.",
    };
    let detail: String = body.chars().take(800).collect();
    Err(AppError::new(ErrorKind::AiFailed, message).with_detail(format!("HTTP {status}: {detail}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_sensitive_and_caps() {
        let raw = "diff --git a/.env b/.env\n+SECRET=1\ndiff --git a/src/a.rs b/src/a.rs\n+fn a() {}\ndiff --git a/certs/server.pem b/certs/server.pem\n+---\n";
        let p = prepare_diff(raw);
        assert_eq!(p.excluded, vec![".env", "certs/server.pem"]);
        assert_eq!(p.files, 1);
        assert!(p.text.contains("src/a.rs"));
        assert!(!p.text.contains("SECRET"));

        let big = format!("diff --git a/x b/x\n{}", "+a\n".repeat(30_000));
        let p = prepare_diff(&big);
        assert!(p.truncated);
        assert!(p.text.len() <= MAX_PROMPT_DIFF_CHARS + 20);
    }

    #[test]
    fn parses_reply_with_noise() {
        let s = parse_reply("Sure!\n```json\n{\"suggestions\":[{\"subject\":\"feat: add x.\",\"body\":\"\"},{\"subject\":\" \",\"body\":\"\"}]}\n```").unwrap();
        assert_eq!(
            s,
            vec![Suggestion {
                subject: "feat: add x".into(),
                body: String::new()
            }]
        );
        assert!(parse_reply("no json here").is_err());
        assert!(parse_reply("{\"suggestions\":[]}").is_err());
    }
}
