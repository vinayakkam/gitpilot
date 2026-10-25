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
    let reply: Reply = parse_json_object(text)?;
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

pub const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";

fn openrouter_base(cfg: &AiSettings) -> String {
    let b = cfg.base_url.trim().trim_end_matches('/');
    if b.is_empty() {
        OPENROUTER_BASE.to_string()
    } else {
        b.to_string()
    }
}

/// OpenRouter asks apps to identify themselves; this shows GitPilot in the user's activity list.
fn openrouter_headers(req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    req.header(
        "HTTP-Referer",
        "https://olittechnologies.co.in/projects/git-pilot/",
    )
    .header("X-Title", "GitPilot")
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| {
            AppError::internal("Couldn't create an HTTP client.").with_detail(e.to_string())
        })
}

fn ensure_enabled(cfg: &AiSettings) -> AppResult<()> {
    if cfg.enabled {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::AiNotConfigured,
            "AI features are turned off. Enable them in Settings → AI.",
        ))
    }
}

/// Name of the model shown next to AI output.
pub fn model_label(cfg: &AiSettings) -> String {
    match (cfg.provider, cfg.model.trim()) {
        (AiProviderKind::ClaudeCode, "") => "Claude Code".to_string(),
        (AiProviderKind::ClaudeCode, m) => format!("Claude Code · {m}"),
        (_, m) => m.to_string(),
    }
}

/// Sends one system + user prompt to the configured provider and returns the reply text.
pub async fn complete(
    cfg: &AiSettings,
    api_key: Option<String>,
    claude: Option<std::path::PathBuf>,
    system: &str,
    user: &str,
    max_tokens: u32,
) -> AppResult<String> {
    ensure_enabled(cfg)?;
    let client = http_client()?;
    let text = match cfg.provider {
        AiProviderKind::OpenRouter => {
            let key = api_key.ok_or_else(|| {
                AppError::new(
                    ErrorKind::AiNotConfigured,
                    "Add your OpenRouter key in Settings → AI. You can create one at openrouter.ai/keys.",
                )
            })?;
            let req = client
                .post(format!("{}/chat/completions", openrouter_base(cfg)))
                .bearer_auth(key)
                .json(&json!({
                    "model": cfg.model.trim(),
                    "temperature": 0.2,
                    "max_tokens": max_tokens,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                }));
            let body: serde_json::Value =
                check(openrouter_headers(req).send().await.map_err(network_err)?).await?;
            if let Some(msg) = body["error"]["message"].as_str() {
                return Err(
                    AppError::new(ErrorKind::AiFailed, "OpenRouter returned an error.")
                        .with_detail(msg.to_string()),
                );
            }
            body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        }
        AiProviderKind::ClaudeCode => {
            let path = claude.ok_or_else(|| {
                AppError::new(
                    ErrorKind::ClaudeCodeNotFound,
                    "Claude Code isn't installed or couldn't be found. Install it, or set its path in Settings → Claude Code.",
                )
            })?;
            let input = format!("{system}\n\n{user}");
            crate::claude_code::print(&path, &cfg.model, &input).await?
        }
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
                    "max_tokens": max_tokens,
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
    if text.trim().is_empty() {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "The AI returned an empty response. Try again, or pick another model.",
        ));
    }
    Ok(text)
}

pub async fn suggest(
    cfg: &AiSettings,
    convention: CommitConvention,
    api_key: Option<String>,
    claude: Option<std::path::PathBuf>,
    raw_diff: &str,
) -> AppResult<AiSuggestions> {
    ensure_enabled(cfg)?;
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
    let text = complete(cfg, api_key, claude, &system, &user, 800).await?;
    Ok(AiSuggestions {
        suggestions: parse_reply(&text)?,
        excluded_files: prepared.excluded,
        truncated: prepared.truncated,
        model: model_label(cfg),
    })
}

/// A plain-language answer, e.g. an explanation of a commit.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiText {
    /// Short paragraphs and "- " bullets (a small Markdown subset).
    pub text: String,
    /// Files left out of the request because they may contain secrets.
    pub excluded_files: Vec<String>,
    /// The diff was shortened to fit the request size limit.
    pub truncated: bool,
    pub model: String,
}

pub const EXPLAIN_SYSTEM: &str = "You explain code changes to a developer who is reviewing them.\n\
Rules:\n\
- Describe only what the diff shows. Never guess at changes that aren't there; say so when the intent is unclear.\n\
- Start with one or two sentences on what the change does overall.\n\
- Then list the notable changes as \"- \" bullets. Mention risks or edge cases only when the diff gives a concrete reason.\n\
- Plain language, at most about 250 words. Use `backticks` for identifiers. No headings, tables or code blocks.\n\
Reply with the explanation only.";

/// Explains a diff (a commit, or one file's changes). `what` describes it, e.g. "Commit abc123: Fix login".
pub async fn explain(
    cfg: &AiSettings,
    api_key: Option<String>,
    claude: Option<std::path::PathBuf>,
    what: &str,
    raw_diff: &str,
) -> AppResult<AiText> {
    ensure_enabled(cfg)?;
    let prepared = prepare_diff(raw_diff);
    if prepared.files == 0 {
        return Err(AppError::invalid(if prepared.excluded.is_empty() {
            "There are no changes to explain."
        } else {
            "The changed files look sensitive (keys, .env files…), so nothing was sent."
        }));
    }
    let user = format!("{what}\n\nDiff:\n\n{}", prepared.text);
    let text = complete(cfg, api_key, claude, EXPLAIN_SYSTEM, &user, 1200).await?;
    Ok(AiText {
        text: strip_fences(&text),
        excluded_files: prepared.excluded,
        truncated: prepared.truncated,
        model: model_label(cfg),
    })
}

/// Models sometimes wrap the whole answer in a code fence despite the instructions.
fn strip_fences(text: &str) -> String {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("```") {
        if let Some(body) = rest.strip_suffix("```") {
            // Drop an optional language tag on the opening fence line.
            let body = body.split_once('\n').map(|(_, b)| b).unwrap_or(body);
            return body.trim().to_string();
        }
    }
    t.to_string()
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrDescription {
    pub title: String,
    /// Markdown.
    pub body: String,
    /// Files left out of the request because they may contain secrets.
    pub excluded_files: Vec<String>,
    /// The diff was shortened to fit the request size limit.
    pub truncated: bool,
    pub model: String,
}

/// GitHub rejects longer pull request titles.
pub const MAX_PR_TITLE: usize = 256;

pub const PR_SYSTEM: &str = "You write GitHub pull request descriptions from a branch's commits and diff.\n\
Rules:\n\
- Describe only what the commits and diff show. Never invent issue numbers, links, test results or motivations.\n\
- Title: imperative mood, at most 72 characters, no trailing period.\n\
- Body: Markdown. One or two sentences summarising the change, then a \"## Changes\" section with \"- \" bullets. Add a \"## Testing\" section only if the diff adds or changes tests, and say only what they cover.\n\
Respond with JSON only, no prose, in exactly this shape:\n\
{\"title\":\"...\",\"body\":\"...\"}";

pub fn parse_pr_reply(text: &str) -> AppResult<PrDescription> {
    #[derive(Deserialize)]
    struct Reply {
        title: String,
        #[serde(default)]
        body: String,
    }
    let reply: Reply = parse_json_object(text)?;
    let title: String = reply
        .title
        .trim()
        .trim_end_matches('.')
        .chars()
        .take(MAX_PR_TITLE)
        .collect();
    if title.is_empty() {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "The AI didn't return a usable title.",
        ));
    }
    Ok(PrDescription {
        title,
        body: reply.body.trim().to_string(),
        excluded_files: Vec::new(),
        truncated: false,
        model: String::new(),
    })
}

/// Writes a pull request title and body. `commits` is a plain list of the branch's commit messages.
pub async fn pr_description(
    cfg: &AiSettings,
    api_key: Option<String>,
    claude: Option<std::path::PathBuf>,
    commits: &str,
    raw_diff: &str,
) -> AppResult<PrDescription> {
    ensure_enabled(cfg)?;
    if commits.trim().is_empty() {
        return Err(AppError::invalid(
            "This branch has no commits that aren't already on the base branch.",
        ));
    }
    let prepared = prepare_diff(raw_diff);
    let user = format!(
        "Commits (oldest first):\n{}\n\nDiff:\n\n{}",
        commits.trim(),
        prepared.text
    );
    let text = complete(cfg, api_key, claude, PR_SYSTEM, &user, 1500).await?;
    let mut d = parse_pr_reply(&text)?;
    d.excluded_files = prepared.excluded;
    d.truncated = prepared.truncated;
    d.model = model_label(cfg);
    Ok(d)
}

/// One conflict as sent to the AI, plus the AI's proposal.
#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConflictSuggestion {
    /// 0-based conflict number in the file.
    pub index: u32,
    /// The conflict exactly as it is in the file, markers included. Sent back when applying,
    /// so a suggestion is never applied to a conflict that has changed since.
    pub block: String,
    pub explanation: String,
    /// Text that replaces the whole conflict.
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConflictHelp {
    pub summary: String,
    pub suggestions: Vec<ConflictSuggestion>,
    pub model: String,
}

pub const CONFLICT_SYSTEM: &str = "You help a developer resolve Git merge conflicts in one file.\n\
For each numbered conflict you get the current branch's version (CURRENT), the version being merged in (INCOMING), the common ancestor (BASE) when available, and a few lines around it.\n\
Rules:\n\
- Propose a resolution that keeps what both sides intended when they are compatible. When they contradict, pick one and say why.\n\
- The resolution is the exact text that replaces the whole conflict: no conflict markers, same indentation and style as the file.\n\
- Never add changes that neither side made, and never touch code outside the conflict.\n\
- If you can't tell what's right, still pick the safest option and say what the developer should check.\n\
- Explanations: one to three plain sentences each. Summary: one or two sentences about what the two sides changed.\n\
Respond with JSON only, no prose, in exactly this shape:\n\
{\"summary\":\"...\",\"blocks\":[{\"index\":0,\"explanation\":\"...\",\"resolution\":\"...\"}]}";

/// Builds the prompt for a conflicted file's blocks.
pub fn conflict_prompt(path: &str, blocks: &[crate::git::rewrite::ConflictBlock]) -> String {
    let mut out = format!("File: {path}\n");
    for b in blocks {
        out.push_str(&format!(
            "\n### Conflict {}\nCURRENT ({}):\n{}\n",
            b.index, b.ours_label, b.ours
        ));
        if let Some(base) = &b.base {
            out.push_str(&format!("BASE:\n{base}\n"));
        }
        out.push_str(&format!(
            "INCOMING ({}):\n{}\nLines before:\n{}\nLines after:\n{}\n",
            b.theirs_label, b.theirs, b.before, b.after
        ));
    }
    out
}

fn is_marker_line(l: &str) -> bool {
    ["<<<<<<<", "=======", ">>>>>>>", "|||||||"]
        .iter()
        .any(|m| l.starts_with(m))
}

/// Matches the AI's reply to the file's conflicts. Suggestions for unknown conflicts, duplicates
/// and resolutions that still contain conflict markers are dropped.
pub fn parse_conflict_reply(
    text: &str,
    blocks: &[crate::git::rewrite::ConflictBlock],
) -> AppResult<(String, Vec<ConflictSuggestion>)> {
    #[derive(Deserialize)]
    struct Item {
        index: u32,
        #[serde(default)]
        explanation: String,
        resolution: String,
    }
    #[derive(Deserialize)]
    struct Reply {
        #[serde(default)]
        summary: String,
        blocks: Vec<Item>,
    }
    let reply: Reply = parse_json_object(text)?;
    let mut out: Vec<ConflictSuggestion> = Vec::new();
    for it in reply.blocks {
        let Some(b) = blocks.iter().find(|b| b.index as u32 == it.index) else {
            continue;
        };
        if out.iter().any(|s| s.index == it.index) || it.resolution.lines().any(is_marker_line) {
            continue;
        }
        out.push(ConflictSuggestion {
            index: it.index,
            block: b.raw.clone(),
            explanation: it.explanation.trim().to_string(),
            resolution: it.resolution,
        });
    }
    out.sort_by_key(|s| s.index);
    if out.is_empty() {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "The AI didn't return a usable suggestion for these conflicts.",
        ));
    }
    Ok((reply.summary.trim().to_string(), out))
}

/// Suggests resolutions for the conflicts in one file. Nothing is changed; the user applies them.
pub async fn conflict_help(
    cfg: &AiSettings,
    api_key: Option<String>,
    claude: Option<std::path::PathBuf>,
    path: &str,
    blocks: &[crate::git::rewrite::ConflictBlock],
) -> AppResult<ConflictHelp> {
    ensure_enabled(cfg)?;
    if is_sensitive(path) {
        return Err(AppError::invalid(
            "This file looks sensitive (keys, .env files…), so it isn't sent to an AI provider.",
        ));
    }
    if blocks.is_empty() {
        return Err(AppError::invalid(
            "There are no conflicts left in this file.",
        ));
    }
    let user = conflict_prompt(path, blocks);
    if user.len() > MAX_PROMPT_DIFF_CHARS {
        return Err(AppError::invalid(
            "These conflicts are too large to send. Resolve them by hand or pick a side for the whole file.",
        ));
    }
    let text = complete(cfg, api_key, claude, CONFLICT_SYSTEM, &user, 4000).await?;
    let (summary, suggestions) = parse_conflict_reply(&text, blocks)?;
    Ok(ConflictHelp {
        summary,
        suggestions,
        model: model_label(cfg),
    })
}

/// Finds the outermost JSON object in a reply (models sometimes add prose or code fences).
fn parse_json_object<T: serde::de::DeserializeOwned>(text: &str) -> AppResult<T> {
    let bad = || {
        AppError::new(
            ErrorKind::AiFailed,
            "The AI response wasn't in the expected format.",
        )
    };
    let (Some(s), Some(e)) = (text.find('{'), text.rfind('}')) else {
        return Err(bad().with_detail(text.chars().take(500).collect::<String>()));
    };
    if e < s {
        return Err(bad().with_detail(text.chars().take(500).collect::<String>()));
    }
    serde_json::from_str(&text[s..=e]).map_err(|err| bad().with_detail(err.to_string()))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    #[ts(type = "number | null")]
    pub context_length: Option<u64>,
    /// US dollars per million input tokens.
    pub prompt_per_million: Option<f64>,
    /// US dollars per million output tokens.
    pub completion_per_million: Option<f64>,
    pub free: bool,
}

fn per_million(v: &serde_json::Value) -> Option<f64> {
    let n = match v {
        serde_json::Value::String(s) => s.parse::<f64>().ok()?,
        serde_json::Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    // Negative prices mark variable-price routers such as openrouter/auto.
    (n >= 0.0).then(|| (n * 1_000_000.0 * 1000.0).round() / 1000.0)
}

/// Parses the `/models` listing, keeping models that can write text.
pub fn parse_models(body: &serde_json::Value) -> Vec<OpenRouterModel> {
    let Some(list) = body["data"].as_array() else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let outputs = &m["architecture"]["output_modalities"];
            if let Some(o) = outputs.as_array() {
                if !o.iter().any(|x| x.as_str() == Some("text")) {
                    return None;
                }
            }
            let prompt = per_million(&m["pricing"]["prompt"]);
            let completion = per_million(&m["pricing"]["completion"]);
            Some(OpenRouterModel {
                name: m["name"].as_str().unwrap_or(&id).to_string(),
                context_length: m["context_length"].as_u64(),
                free: id.ends_with(":free") || (prompt == Some(0.0) && completion == Some(0.0)),
                prompt_per_million: prompt,
                completion_per_million: completion,
                id,
            })
        })
        .collect()
}

pub async fn openrouter_models(
    cfg: &AiSettings,
    key: Option<String>,
) -> AppResult<Vec<OpenRouterModel>> {
    let mut req = http_client()?.get(format!("{}/models", openrouter_base(cfg)));
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let body = check(openrouter_headers(req).send().await.map_err(network_err)?).await?;
    let models = parse_models(&body);
    if models.is_empty() {
        return Err(AppError::new(
            ErrorKind::AiFailed,
            "OpenRouter didn't return any models.",
        ));
    }
    Ok(models)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OpenRouterKeyInfo {
    pub label: String,
    /// Credits used so far, in US dollars.
    pub usage: f64,
    /// Spending limit on this key, if any.
    pub limit: Option<f64>,
    pub limit_remaining: Option<f64>,
    pub is_free_tier: bool,
}

pub fn parse_key_info(body: &serde_json::Value) -> OpenRouterKeyInfo {
    let d = &body["data"];
    OpenRouterKeyInfo {
        label: d["label"].as_str().unwrap_or("").to_string(),
        usage: d["usage"].as_f64().unwrap_or(0.0),
        limit: d["limit"].as_f64(),
        limit_remaining: d["limit_remaining"].as_f64(),
        is_free_tier: d["is_free_tier"].as_bool().unwrap_or(false),
    }
}

/// Checks a key and returns its usage and limits.
pub async fn openrouter_key_info(
    cfg: &AiSettings,
    key: Option<String>,
) -> AppResult<OpenRouterKeyInfo> {
    let key = key.ok_or_else(|| {
        AppError::new(
            ErrorKind::AiNotConfigured,
            "No OpenRouter key is saved yet.",
        )
    })?;
    let req = http_client()?
        .get(format!("{}/key", openrouter_base(cfg)))
        .bearer_auth(key);
    let body = check(openrouter_headers(req).send().await.map_err(network_err)?).await?;
    Ok(parse_key_info(&body))
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
        402 => {
            "The AI provider says the account is out of credits. Add credits or pick a free model."
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
    fn parses_openrouter_models_and_key() {
        let body = serde_json::json!({"data": [
            {"id": "openrouter/auto", "name": "Auto Router", "context_length": 2000000,
             "pricing": {"prompt": "-1", "completion": "-1"},
             "architecture": {"output_modalities": ["text"]}},
            {"id": "acme/small:free", "name": "Acme Small (free)", "context_length": 8192,
             "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "acme/large", "name": "Acme Large",
             "pricing": {"prompt": "0.000003", "completion": "0.000015"},
             "architecture": {"output_modalities": ["text"]}},
            {"id": "acme/painter", "name": "Painter",
             "architecture": {"output_modalities": ["image"]}}
        ]});
        let m = parse_models(&body);
        assert_eq!(m.len(), 3);
        assert_eq!(m[0].prompt_per_million, None);
        assert!(m[1].free);
        assert_eq!(m[2].prompt_per_million, Some(3.0));
        assert_eq!(m[2].completion_per_million, Some(15.0));
        assert!(!m[2].free);

        let k = parse_key_info(
            &serde_json::json!({"data": {"label": "sk-or-v1-abc...", "usage": 1.25, "limit": null, "limit_remaining": null, "is_free_tier": false}}),
        );
        assert_eq!(k.usage, 1.25);
        assert_eq!(k.limit, None);
    }

    #[test]
    fn parses_pr_reply() {
        let d = parse_pr_reply("```json\n{\"title\":\" Add login. \",\"body\":\"Adds it.\\n\\n## Changes\\n- a\"}\n```").unwrap();
        assert_eq!(d.title, "Add login");
        assert!(d.body.starts_with("Adds it.\n\n## Changes"));
        let long = format!("{{\"title\":\"{}\"}}", "x".repeat(400));
        assert_eq!(parse_pr_reply(&long).unwrap().title.len(), MAX_PR_TITLE);
        assert!(parse_pr_reply("{\"title\":\"  \"}").is_err());
        assert!(parse_pr_reply("} no json {").is_err());
    }

    #[test]
    fn strips_wrapping_fence() {
        assert_eq!(strip_fences("```markdown\nHello\n- a\n```"), "Hello\n- a");
        assert_eq!(strip_fences("Plain `x`."), "Plain `x`.");
    }

    #[test]
    fn conflict_prompt_and_reply() {
        let text = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<< HEAD\nm2\n=======\nt2\n>>>>>>> feature\n";
        let blocks = crate::git::rewrite::conflict_blocks(text, 2);
        let prompt = conflict_prompt("src/x.rs", &blocks);
        assert!(prompt.contains("File: src/x.rs"));
        assert!(prompt.contains("### Conflict 0\nCURRENT (HEAD):\nmine\n"));
        assert!(prompt.contains("INCOMING (feature):\nt2\n"));

        let reply = r#"Here you go: {"summary":"Both renamed it.","blocks":[
            {"index":1,"explanation":"Keep both.","resolution":"m2\nt2\n"},
            {"index":0,"explanation":"Theirs is newer.","resolution":"theirs\n"},
            {"index":0,"explanation":"dup","resolution":"x"},
            {"index":7,"explanation":"unknown","resolution":"x"}]}"#;
        let (summary, s) = parse_conflict_reply(reply, &blocks).unwrap();
        assert_eq!(summary, "Both renamed it.");
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].index, s[0].resolution.as_str()), (0, "theirs\n"));
        assert_eq!(s[0].block, blocks[0].raw);
        assert_eq!(s[1].explanation, "Keep both.");

        // Resolutions that still contain conflict markers are never offered.
        let bad = r#"{"summary":"","blocks":[{"index":0,"resolution":"<<<<<<< HEAD\nx\n"}]}"#;
        assert!(parse_conflict_reply(bad, &blocks).is_err());
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
