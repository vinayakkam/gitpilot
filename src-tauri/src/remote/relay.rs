//! Talking to the relay.
//!
//! The relay is a post box, not a server we trust: it holds sealed envelopes for a few minutes and
//! hands them to whichever side asks with the right secret. Everything here is an outbound HTTPS
//! call, so nothing has to be opened at the user's home router.
//!
//! Two rules shape this module. The relay runs on a very small host, so GitPilot must not hammer
//! it: it polls slowly unless a phone is actually being used, and backs off hard when the relay is
//! unhappy. And the channel secret must never surface -- it travels in a query string, so every
//! error that could carry a URL is scrubbed before it becomes an `AppError`.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, ErrorKind};

/// The user's own relay. Overridable for tests and for anyone self-hosting it.
pub const DEFAULT_BASE: &str = "https://api.olittechnologies.co.in";

/// While a phone has been heard from recently, answers should feel immediate.
pub const ACTIVE_POLL: Duration = Duration::from_secs(3);
/// Otherwise GitPilot is only listening for a phone that might wake up.
pub const IDLE_POLL: Duration = Duration::from_secs(15);
/// A phone is "active" for this long after its last message.
pub const ACTIVE_FOR: Duration = Duration::from_secs(300);

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// One pairing channel, as the relay hands it back. The PC keeps `secret`; `peer_secret` goes to
/// the phone in the QR code and never anywhere else.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub secret: String,
    pub peer_secret: String,
}

/// One sealed message waiting in a mailbox.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Message {
    /// The relay's own sequence number, for `since` on the next poll.
    pub n: u64,
    /// A `crypto::Envelope` as JSON. The relay can't read it, and neither does this module.
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Polled {
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub last: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub ok: bool,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub channels: u64,
}

#[derive(Debug, Deserialize)]
struct RelayError {
    error: Option<String>,
}

/// How long to wait after `failures` calls in a row have failed.
///
/// Doubling from the active interval up to a minute: a phone on a train, or a relay being
/// restarted, must not turn into a steady stream of requests against a 720 MiB box.
pub fn backoff(failures: u32) -> Duration {
    if failures == 0 {
        return ACTIVE_POLL;
    }
    let secs = ACTIVE_POLL.as_secs().saturating_mul(1 << failures.min(5));
    Duration::from_secs(secs.min(60))
}

/// How long to wait before polling again, given how long ago a phone last said something.
pub fn poll_interval(since_last_message: Duration) -> Duration {
    if since_last_message <= ACTIVE_FOR {
        ACTIVE_POLL
    } else {
        IDLE_POLL
    }
}

/// Removes anything secret-shaped from text that is about to be shown or stored.
///
/// `poll` puts the channel secret in the query string, and a reqwest error prints the URL it was
/// talking to, so without this a timeout could write the secret into a toast.
fn scrub(text: impl Into<String>, secrets: &[&str]) -> String {
    let mut out = text.into();
    for s in secrets {
        if s.len() >= 4 {
            out = out.replace(s, "<removed>");
        }
    }
    out
}

fn network_error(what: &str, e: reqwest::Error, secrets: &[&str]) -> AppError {
    let kind = if e.is_timeout() {
        ErrorKind::Timeout
    } else {
        ErrorKind::NetworkFailed
    };
    AppError::new(
        kind,
        format!("Couldn't reach the remote-control relay to {what}. Check this computer's internet connection."),
    )
    .with_detail(scrub(e.to_string(), secrets))
}

pub struct RelayClient {
    base: String,
    http: reqwest::Client,
}

impl RelayClient {
    pub fn new(base: &str) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("GitPilot/", env!("CARGO_PKG_VERSION")))
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|e| {
                AppError::new(
                    ErrorKind::Internal,
                    "Couldn't start the remote-control client.",
                )
                .with_detail(e.to_string())
            })?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            http,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/remote/{path}", self.base)
    }

    /// Turns a non-2xx answer into a sentence the user can act on.
    async fn check(
        &self,
        res: reqwest::Response,
        what: &str,
        secrets: &[&str],
    ) -> AppResult<String> {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if status.is_success() {
            return Ok(body);
        }
        let detail = serde_json::from_str::<RelayError>(&body)
            .ok()
            .and_then(|e| e.error)
            .unwrap_or_else(|| scrub(body.clone(), secrets));
        let message = match status.as_u16() {
            403 => "The relay refused this computer's key for that phone. Remove the phone in Settings and pair it again.".to_string(),
            404 => "That phone's channel is no longer on the relay. Pair the phone again.".to_string(),
            413 => "That message was too large to send to the phone.".to_string(),
            429 => "The relay is rate-limiting this computer. GitPilot will try again shortly.".to_string(),
            503 => "Remote control is switched off on the relay, or it is full.".to_string(),
            _ => format!("The remote-control relay couldn't {what} (HTTP {status})."),
        };
        Err(AppError::new(ErrorKind::NetworkFailed, message).with_detail(scrub(detail, secrets)))
    }

    /// Opens a channel. Called once per phone, when the user starts pairing.
    pub async fn register(&self) -> AppResult<Channel> {
        let res = self
            .http
            .post(self.url("register"))
            .send()
            .await
            .map_err(|e| network_error("start pairing", e, &[]))?;
        let body = self.check(res, "start pairing", &[]).await?;
        serde_json::from_str(&body).map_err(|e| {
            AppError::new(
                ErrorKind::NetworkFailed,
                "The relay's answer wasn't understood.",
            )
            .with_detail(e.to_string())
        })
    }

    /// Puts one sealed envelope in the phone's mailbox.
    pub async fn send(&self, id: &str, secret: &str, body: &str) -> AppResult<()> {
        let res = self
            .http
            .post(self.url("send"))
            .json(&serde_json::json!({ "id": id, "secret": secret, "body": body }))
            .send()
            .await
            .map_err(|e| network_error("answer the phone", e, &[secret]))?;
        self.check(res, "answer the phone", &[secret]).await?;
        Ok(())
    }

    /// Takes everything waiting for this computer. `since` is the last relay sequence number seen.
    pub async fn poll(&self, id: &str, secret: &str, since: u64) -> AppResult<Polled> {
        let res = self
            .http
            .get(self.url("poll"))
            .query(&[
                ("id", id),
                ("secret", secret),
                ("since", &since.to_string()),
            ])
            .send()
            .await
            .map_err(|e| network_error("check for commands", e, &[secret]))?;
        let body = self.check(res, "check for commands", &[secret]).await?;
        serde_json::from_str(&body).map_err(|e| {
            AppError::new(
                ErrorKind::NetworkFailed,
                "The relay's answer wasn't understood.",
            )
            .with_detail(scrub(e.to_string(), &[secret]))
        })
    }

    /// Closes a channel: the user removed the phone. A channel that is already gone is fine.
    pub async fn unregister(&self, id: &str, secret: &str) -> AppResult<()> {
        let res = self
            .http
            .post(self.url("unregister"))
            .json(&serde_json::json!({ "id": id, "secret": secret }))
            .send()
            .await
            .map_err(|e| network_error("remove the phone", e, &[secret]))?;
        if res.status().as_u16() == 404 {
            return Ok(());
        }
        self.check(res, "remove the phone", &[secret]).await?;
        Ok(())
    }

    /// Is the relay up, and is remote control switched on there? Shown in Settings.
    pub async fn health(&self) -> AppResult<Health> {
        let res = self
            .http
            .get(self.url("health"))
            .send()
            .await
            .map_err(|e| network_error("check the relay", e, &[]))?;
        let body = self.check(res, "check the relay", &[]).await?;
        serde_json::from_str(&body).map_err(|e| {
            AppError::new(
                ErrorKind::NetworkFailed,
                "The relay's answer wasn't understood.",
            )
            .with_detail(e.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A throwaway HTTP server: answers each request with the next canned response and records
    /// what it was asked. Enough to pin down this module without a mock-server dependency.
    struct Stub {
        base: String,
        seen: Arc<Mutex<Vec<String>>>,
    }

    async fn stub(responses: Vec<(u16, &'static str)>) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let recorder = seen.clone();

        tokio::spawn(async move {
            for (code, body) in responses {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                recorder
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..n]).to_string());
                let res = format!(
                    "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(res.as_bytes()).await;
                let _ = sock.flush().await;
            }
        });

        Stub { base, seen }
    }

    impl Stub {
        fn client(&self) -> RelayClient {
            RelayClient::new(&self.base).unwrap()
        }
        fn requests(&self) -> Vec<String> {
            self.seen.lock().unwrap().clone()
        }
    }

    #[tokio::test]
    async fn register_reads_both_secrets() {
        let s = stub(vec![(
            200,
            r#"{"ok":true,"id":"chan1","secret":"pc-secret","peerSecret":"phone-secret"}"#,
        )])
        .await;

        let ch = s.client().register().await.unwrap();

        assert_eq!(ch.id, "chan1");
        assert_eq!(ch.secret, "pc-secret");
        assert_eq!(ch.peer_secret, "phone-secret");
        assert!(s.requests()[0].starts_with("POST /remote/register"));
    }

    #[tokio::test]
    async fn poll_returns_the_sealed_bodies_untouched() {
        let s = stub(vec![(
            200,
            r#"{"ok":true,"last":4,"messages":[{"n":3,"body":"{\"v\":1}"},{"n":4,"body":"second"}]}"#,
        )])
        .await;

        let got = s.client().poll("chan1", "pc-secret", 2).await.unwrap();

        assert_eq!(got.last, 4);
        assert_eq!(got.messages.len(), 2);
        assert_eq!(got.messages[0].body, r#"{"v":1}"#);
        let req = &s.requests()[0];
        assert!(req.contains("since=2"), "{req}");
        assert!(req.contains("id=chan1"), "{req}");
    }

    #[tokio::test]
    async fn an_empty_mailbox_is_not_an_error() {
        let s = stub(vec![(200, r#"{"ok":true,"last":0,"messages":[]}"#)]).await;

        let got = s.client().poll("chan1", "pc-secret", 0).await.unwrap();

        assert!(got.messages.is_empty());
    }

    #[tokio::test]
    async fn send_puts_the_envelope_in_the_body() {
        let s = stub(vec![(200, r#"{"ok":true,"n":1}"#)]).await;

        s.client()
            .send("chan1", "pc-secret", "sealed")
            .await
            .unwrap();

        let req = &s.requests()[0];
        assert!(req.starts_with("POST /remote/send"));
        assert!(req.contains(r#""body":"sealed""#), "{req}");
    }

    #[tokio::test]
    async fn a_rejected_secret_says_to_pair_again() {
        let s = stub(vec![(403, r#"{"ok":false,"error":"wrong secret"}"#)]).await;

        let err = s.client().poll("chan1", "pc-secret", 0).await.unwrap_err();

        assert_eq!(err.kind, ErrorKind::NetworkFailed);
        assert!(err.message.contains("pair it again"), "{}", err.message);
    }

    #[tokio::test]
    async fn a_missing_channel_says_to_pair_again() {
        let s = stub(vec![(404, r#"{"ok":false,"error":"unknown id"}"#)]).await;

        let err = s
            .client()
            .send("chan1", "pc-secret", "x")
            .await
            .unwrap_err();

        assert!(
            err.message.contains("Pair the phone again"),
            "{}",
            err.message
        );
    }

    #[tokio::test]
    async fn rate_limiting_is_explained_rather_than_blamed_on_the_user() {
        let s = stub(vec![(429, r#"{"ok":false,"error":"too many calls"}"#)]).await;

        let err = s.client().poll("chan1", "pc-secret", 0).await.unwrap_err();

        assert!(err.message.contains("rate-limiting"), "{}", err.message);
    }

    #[tokio::test]
    async fn a_switched_off_relay_is_explained() {
        let s = stub(vec![(503, r#"{"ok":false,"error":"disabled"}"#)]).await;

        let err = s.client().register().await.unwrap_err();

        assert!(err.message.contains("switched off"), "{}", err.message);
    }

    #[tokio::test]
    async fn removing_a_phone_twice_is_fine() {
        let s = stub(vec![(404, r#"{"ok":false,"error":"unknown id"}"#)]).await;

        // The channel expired on its own; the user still expects "removed".
        s.client().unregister("chan1", "pc-secret").await.unwrap();
    }

    #[tokio::test]
    async fn the_channel_secret_never_reaches_an_error_message() {
        let secret = "SUPERSECRETVALUE";
        let s = stub(vec![(500, "SUPERSECRETVALUE leaked into the body")]).await;

        let err = s.client().poll("chan1", secret, 0).await.unwrap_err();

        let shown = format!("{} {}", err.message, err.detail.clone().unwrap_or_default());
        assert!(!shown.contains(secret), "secret leaked: {shown}");
        assert!(shown.contains("<removed>"), "{shown}");
    }

    #[tokio::test]
    async fn an_unreachable_relay_is_a_network_error_not_a_crash() {
        // Nothing is listening on this port.
        let client = RelayClient::new("http://127.0.0.1:1").unwrap();

        let err = client.health().await.unwrap_err();

        assert!(matches!(
            err.kind,
            ErrorKind::NetworkFailed | ErrorKind::Timeout
        ));
        assert!(
            err.message.contains("internet connection"),
            "{}",
            err.message
        );
    }

    #[tokio::test]
    async fn health_reports_whether_the_relay_is_on() {
        let s = stub(vec![(200, r#"{"ok":true,"enabled":true,"channels":2}"#)]).await;

        let h = s.client().health().await.unwrap();

        assert!(h.ok && h.enabled);
        assert_eq!(h.channels, 2);
    }

    #[test]
    fn polling_is_quick_while_a_phone_is_in_use_and_slow_otherwise() {
        assert_eq!(poll_interval(Duration::from_secs(1)), ACTIVE_POLL);
        assert_eq!(poll_interval(ACTIVE_FOR), ACTIVE_POLL);
        assert_eq!(
            poll_interval(ACTIVE_FOR + Duration::from_secs(1)),
            IDLE_POLL
        );
    }

    #[test]
    fn backing_off_doubles_but_stops_at_a_minute() {
        assert_eq!(backoff(0), ACTIVE_POLL);
        assert_eq!(backoff(1), Duration::from_secs(6));
        assert_eq!(backoff(2), Duration::from_secs(12));
        assert_eq!(backoff(3), Duration::from_secs(24));
        assert_eq!(backoff(4), Duration::from_secs(48));
        assert_eq!(backoff(5), Duration::from_secs(60));
        assert_eq!(backoff(50), Duration::from_secs(60));
    }

    #[test]
    fn scrubbing_leaves_short_strings_alone() {
        // A two-character "secret" would otherwise blank out half the message.
        assert_eq!(scrub("an error at id ab", &["ab"]), "an error at id ab");
        assert_eq!(
            scrub("token abcdef here", &["abcdef"]),
            "token <removed> here"
        );
    }
}
