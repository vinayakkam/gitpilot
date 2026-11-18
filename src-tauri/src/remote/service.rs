//! Pairing a phone, and the loop that listens for it.
//!
//! This is where the three other modules meet: `relay` carries sealed blobs, `crypto` decides
//! whether one is genuine, `dispatch` does the work. Nothing here parses a command itself, and
//! nothing here touches a repository directly.
//!
//! The loop is deliberately dull. It polls on a slow timer, works through whatever was waiting,
//! answers each message, and gives up quietly when the network is away -- a laptop that is asleep
//! or offline must not pile up retries against a very small relay.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::remote::crypto::{self, Envelope, PairingKey, ReplayGuard};
use crate::remote::dispatch::{self, Command};
use crate::remote::relay::{self, RelayClient};
use crate::secrets::{self, RemotePairing};
use crate::settings::RemoteDevice;
use crate::state::AppState;

/// Where the phone app is served from. The pairing details ride in the URL's fragment, which
/// browsers never send to a server -- so neither GitHub Pages nor anyone hosting the page ever
/// sees a key.
pub const PHONE_APP: &str = "https://olittechnologies.co.in/remote/";

/// What the QR code says, and what Settings shows while pairing.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Pairing {
    pub device: String,
    pub name: String,
    /// The whole URL encoded into the QR code. Never logged, never copied to the clipboard.
    pub url: String,
}

/// Remote control's state, for Settings.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteStatus {
    pub enabled: bool,
    pub relay_base: String,
    pub devices: Vec<RemoteDevice>,
    /// `None` until the relay has been asked; `Some(false)` means it answered but is switched off.
    pub relay_ok: Option<bool>,
    pub relay_error: Option<String>,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The id a phone puts in its envelopes is its device id; this computer answers under a different
/// one, so a reply can never be mistaken for a command (or replayed back as one).
pub fn pc_id(device: &str) -> String {
    format!("{device}~pc")
}

fn client(state: &AppState) -> AppResult<RelayClient> {
    RelayClient::new(&state.settings().remote.relay_base)
}

fn device_of(state: &AppState, id: &str) -> AppResult<RemoteDevice> {
    state
        .settings()
        .remote
        .devices
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidInput, "That phone isn't paired any more."))
}

fn pairing_of(device: &str) -> AppResult<RemotePairing> {
    secrets::remote_get(device).ok_or_else(|| {
        AppError::new(
            ErrorKind::Keychain,
            "This phone's key isn't in the system keychain any more. Remove the phone and pair it again.",
        )
    })
}

/// Opens a channel on the relay, makes a key, and returns the QR contents.
///
/// The phone is "paired" the moment it says hello; until then the device sits in settings with no
/// `last_seen`, and Settings shows it as waiting.
pub async fn pair_start(state: &AppState, name: &str) -> AppResult<Pairing> {
    let name = name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::invalid(
            "Give the phone a short name, like Pixel.",
        ));
    }
    let key = PairingKey::generate();
    let device = key.device_id();
    claim_channel(state, &key).await?;

    // The keychain first: if it can't hold the key, nothing else should happen.
    secrets::remote_set(
        &device,
        &RemotePairing {
            key: key.to_b64(),
            channel_secret: key.pc_secret(),
        },
    )?;

    state.update_settings(|s| {
        s.remote.enabled = true;
        s.remote.devices.retain(|d| d.id != device);
        s.remote.devices.push(RemoteDevice {
            id: device.clone(),
            name: name.to_string(),
            channel_id: key.channel_id(),
            paired_at: now(),
            last_seen: None,
            seq_in: 0,
            seq_out: 0,
        });
    })?;

    Ok(Pairing {
        device: device.clone(),
        name: name.to_string(),
        // Only the key. The phone derives the channel and both secrets from it, exactly as this
        // computer does, and the fragment never leaves the browser -- so the key reaches the
        // phone app without passing through any server.
        url: format!("{PHONE_APP}#k={}", key.to_b64()),
    })
}

/// Puts this pairing's channel on the relay, whether or not it is already there.
///
/// Safe to call at any time: claiming a channel that already exists with the same secrets changes
/// nothing, and the relay refuses a claim from anyone who cannot produce them.
async fn claim_channel(state: &AppState, key: &PairingKey) -> AppResult<()> {
    client(state)?
        .claim(&key.channel_id(), &key.pc_secret(), &key.phone_secret())
        .await?;
    Ok(())
}

/// Forgets a phone without touching its relay channel, which the phone is still listening on.
///
/// Used when the phone itself asks to be forgotten: it has just been told, and dropping the
/// channel from under it would lose that answer. The channel expires on its own within the hour.
async fn forget_device(state: &AppState, device: &str) -> AppResult<()> {
    secrets::remote_clear(device)?;
    state.update_settings(|s| {
        s.remote.devices.retain(|d| d.id != device);
    })
}

/// Forgets a phone: its key, its settings entry, and its channel on the relay.
///
/// The key goes first. If the relay is unreachable the phone is still forgotten here, because the
/// user asked for it to be gone -- and without the key the channel is useless to anyone.
pub async fn remove_device(state: &AppState, device: &str) -> AppResult<()> {
    let found = device_of(state, device).ok();
    let channel = secrets::remote_get(device)
        .and_then(|p| PairingKey::from_b64(&p.key).ok())
        .map(|k| (k.channel_id(), k.pc_secret()));
    secrets::remote_clear(device)?;
    state.update_settings(|s| {
        s.remote.devices.retain(|d| d.id != device);
    })?;
    if let (Some(_), Some((id, secret))) = (found, channel) {
        let _ = client(state)?.unregister(&id, &secret).await;
    }
    Ok(())
}

/// Opens one sealed message, does what it says, and seals the answer.
///
/// Returns `None` when the message isn't genuine -- wrong key, a replay, a stale clock. Nothing is
/// sent back in that case: an attacker who can post to the relay learns nothing from silence, and
/// a real phone retries on its own.
pub async fn handle_envelope(state: &AppState, device: &str, body: &str) -> Option<String> {
    let env: Envelope = serde_json::from_str(body).ok()?;
    let record = device_of(state, device).ok()?;
    let pairing = pairing_of(device).ok()?;
    let key = PairingKey::from_b64(&pairing.key).ok()?;

    let plain = {
        let mut seen = SEEN.lock().ok()?;
        let guard = seen.entry(device.to_string()).or_default();
        crypto::open(&key, &env, device, guard, now()).ok()?
    };

    // Accepted: remember the sequence number before doing the work, so a command that crashes
    // GitPilot halfway still can't be replayed afterwards.
    let seq_out = record.seq_out + 1;
    let _ = state.update_settings(|s| {
        if let Some(d) = s.remote.devices.iter_mut().find(|d| d.id == device) {
            d.seq_in = env.seq;
            d.seq_out = seq_out;
            d.last_seen = Some(now());
        }
    });

    let reply = match serde_json::from_slice::<Command>(&plain) {
        // "Forget this computer" on the phone. Answered here rather than in `dispatch`, because
        // only this knows which device sent it -- so a phone can unpair itself and nothing else.
        // The answer is sealed before the key is thrown away, so the phone still hears back.
        Ok(Command::Unpair) => {
            let answer = dispatch::Reply::ok("This computer has forgotten the phone");
            let sealed = serde_json::to_vec(&answer)
                .ok()
                .map(|json| crypto::seal(&key, &pc_id(device), seq_out, now(), &json))
                .and_then(|env| serde_json::to_string(&env).ok());
            let _ = forget_device(state, device).await;
            return sealed;
        }
        Ok(cmd) => dispatch::dispatch(state, cmd).await,
        // A phone on a newer version asking for something this build doesn't have.
        Err(e) => dispatch::Reply::unknown_command(&e.to_string()),
    };

    let json = serde_json::to_vec(&reply).ok()?;
    let sealed = crypto::seal(&key, &pc_id(device), seq_out, now(), &json);
    serde_json::to_string(&sealed).ok()
}

/// What one pass of the loop did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Pass {
    /// Commands handled and answered.
    pub handled: usize,
    /// The relay couldn't be reached, or refused us, for at least one phone.
    pub failed: bool,
}

/// One pass: ask the relay for each paired phone's messages and answer them.
pub async fn poll_once(state: &AppState) -> Pass {
    let settings = state.settings();
    if !settings.remote.enabled || settings.remote.devices.is_empty() {
        return Pass::default();
    }
    let Ok(client) = client(state) else {
        return Pass::default();
    };

    let mut pass = Pass::default();
    for device in settings.remote.devices {
        let Some(pairing) = secrets::remote_get(&device.id) else {
            continue; // Key gone: the phone is effectively unpaired; Settings shows it.
        };
        let Ok(key) = PairingKey::from_b64(&pairing.key) else {
            continue;
        };
        let (channel, secret) = (key.channel_id(), key.pc_secret());

        let polled = match client.poll(&channel, &secret, 0).await {
            Ok(Some(polled)) => polled,
            // The relay has forgotten this channel: it restarted, or nobody polled it for an hour
            // while the computer was off. Put it back and collect messages next pass. The phone
            // does the same from its side, so neither of them has to be paired again.
            Ok(None) => {
                if claim_channel(state, &key).await.is_err() {
                    pass.failed = true;
                }
                continue;
            }
            Err(_) => {
                pass.failed = true; // Offline or rate-limited; try again, less often.
                continue;
            }
        };

        for message in polled.messages {
            if let Some(reply) = handle_envelope(state, &device.id, &message.body).await {
                match client.send(&channel, &secret, &reply).await {
                    Ok(true) => {}
                    // Gone between the poll and the answer: put it back and let the phone retry.
                    Ok(false) => {
                        let _ = claim_channel(state, &key).await;
                        pass.failed = true;
                    }
                    Err(_) => pass.failed = true,
                }
                pass.handled += 1;
            }
        }
    }
    pass
}

/// What has already been heard from each phone, so nothing is accepted twice.
///
/// In memory only, and deliberately so: an empty guard is a correct guard, because a message old
/// enough to predate it is refused by its timestamp. Nothing here has to survive a restart, which
/// is what makes a pairing impossible to break by losing state.
static SEEN: once_cell::sync::Lazy<
    std::sync::Mutex<std::collections::HashMap<String, ReplayGuard>>,
> = once_cell::sync::Lazy::new(Default::default);

/// Only one listening loop runs at a time, however often Settings turns the feature on.
///
/// Released by `ListeningGuard` whatever happens to the loop -- including a panic. Leaving this
/// set would stop any later loop from starting, and remote control would be quietly dead until
/// GitPilot was restarted.
static LISTENING: AtomicBool = AtomicBool::new(false);

struct ListeningGuard;

impl Drop for ListeningGuard {
    fn drop(&mut self) {
        LISTENING.store(false, Ordering::SeqCst);
    }
}

/// Starts the loop if it isn't already running. It stops on its own when the feature is turned
/// off, so nothing has to be cancelled from outside.
pub fn spawn_loop(app: &tauri::AppHandle) {
    use tauri::Manager;

    if LISTENING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = ListeningGuard;
        let mut failures = 0u32;
        loop {
            let delay = {
                let Some(state) = app.try_state::<AppState>() else {
                    break;
                };
                if !state.settings().remote.enabled {
                    break;
                }
                let pass = poll_once(&state).await;
                failures = if pass.failed { failures + 1 } else { 0 };
                if pass.handled > 0 {
                    use tauri::Emitter;
                    let _ = app.emit("remote-activity", pass.handled);
                }
                next_delay(&state, pass.handled, failures)
            };
            tokio::time::sleep(delay).await;
        }
    });
}

/// Right after a command, the phone is almost certainly about to send another, so for a short
/// while we look much more often. This is most of what "it feels slow" was.
const HOT_POLL: Duration = Duration::from_millis(400);
const HOT_FOR: Duration = Duration::from_secs(15);

/// How long to wait before the next pass, from this pass's result and the devices' last activity.
pub fn next_delay(state: &AppState, handled: usize, failures: u32) -> Duration {
    if failures > 0 {
        return relay::backoff(failures);
    }
    if handled > 0 {
        return HOT_POLL;
    }
    let newest = state
        .settings()
        .remote
        .devices
        .iter()
        .filter_map(|d| d.last_seen)
        .max();
    match newest {
        Some(seen) => {
            let since = Duration::from_secs((now() - seen).max(0) as u64);
            if since <= HOT_FOR {
                HOT_POLL
            } else {
                relay::poll_interval(since)
            }
        }
        None => relay::IDLE_POLL,
    }
}

/// Is the relay reachable, and is remote control switched on there?
pub async fn relay_health(state: &AppState) -> (Option<bool>, Option<String>) {
    match client(state) {
        Ok(c) => match c.health().await {
            Ok(h) => (Some(h.ok && h.enabled), None),
            Err(e) => (Some(false), Some(e.message)),
        },
        Err(e) => (None, Some(e.message)),
    }
}

pub async fn status(state: &AppState) -> RemoteStatus {
    let s = state.settings().remote;
    let (relay_ok, relay_error) = if s.enabled {
        relay_health(state).await
    } else {
        (None, None)
    };
    RemoteStatus {
        enabled: s.enabled,
        relay_base: s.relay_base,
        devices: s.devices,
        relay_ok,
        relay_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_is_sealed_under_a_different_identity_than_the_command() {
        // Otherwise an answer could be posted back as if it were a command from the phone.
        assert_eq!(pc_id("dabc"), "dabc~pc");
        assert_ne!(pc_id("dabc"), "dabc");
    }

    #[test]
    fn the_qr_url_keeps_the_key_in_the_fragment() {
        // Everything after '#' stays in the browser: it never reaches the page's host.
        let url = format!("{PHONE_APP}#i=chan&s=peer&k=key&d=dev");
        let (before, after) = url.split_once('#').unwrap();

        assert!(!before.contains("key"));
        assert!(after.contains("k=key"));
        assert!(before.starts_with("https://"));
    }
}
