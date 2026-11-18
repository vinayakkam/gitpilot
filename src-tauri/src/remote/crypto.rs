//! Sealing the messages between the phone and this computer.
//!
//! The relay in the middle is public and untrusted: it sees only what is in this module's
//! envelopes, and must not be able to read a command, forge one, or replay one it saw earlier.
//! Everything rests on the pairing key, which is generated here and reaches the phone only
//! through the QR code the user scans.
//!
//! AES-256-GCM, because the phone opens these in the browser with WebCrypto, which has it
//! natively -- no crypto library to ship, review or keep up to date on that side.
//!
//! The wire format is one JSON object:
//!
//! ```json
//! { "v": 1, "id": "<device>", "seq": 12, "ts": 1763300000, "nonce": "<b64url>", "ct": "<b64url>" }
//! ```
//!
//! `v`, `id`, `seq` and `ts` travel in the clear so the receiver can check them before spending
//! anything on decryption, and they are the *associated data*, so changing any of them breaks the
//! tag: nobody can move a sealed command to another device, replay it under a new sequence
//! number, or backdate it.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::{AppError, ErrorKind};

/// How many recent nonces to remember per device. A message every second for five minutes is 300,
/// so this holds far more than the window can contain while staying tiny.
const SEEN_LIMIT: usize = 512;

/// Bumped only if the format changes in a way an older phone can't read.
pub const PROTOCOL_VERSION: u8 = 1;

pub const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;

/// How far apart the two clocks may be. Generous enough for a phone that never syncs its time,
/// short enough that a command recorded off the relay is useless later.
pub const MAX_CLOCK_SKEW_SECS: i64 = 300;

/// Remembers the messages seen lately, so none can be used twice.
///
/// This replaces counting. A counter has to be kept by both ends for the life of the pairing, and
/// if either one loses it -- a phone with its site data cleared, settings restored from a backup --
/// every later message looks like a replay and the two can never talk again. Nothing recovers from
/// that but pairing afresh.
///
/// A nonce is 96 random bits, chosen anew for every message, so remembering the ones seen inside
/// the five-minute window catches a replay just as well, and it costs nothing to rebuild: an empty
/// guard is a correct guard, because anything older than the window is refused by its timestamp.
#[derive(Debug, Default)]
pub struct ReplayGuard {
    seen: std::collections::VecDeque<(String, i64)>,
}

impl ReplayGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// True if this nonce is new. Forgets anything older than the clock window as it goes.
    fn accept(&mut self, nonce: &str, now: i64) -> bool {
        while let Some((_, when)) = self.seen.front() {
            if (now - when).abs() > MAX_CLOCK_SKEW_SECS || self.seen.len() > SEEN_LIMIT {
                self.seen.pop_front();
            } else {
                break;
            }
        }
        if self.seen.iter().any(|(seen, _)| seen == nonce) {
            return false;
        }
        self.seen.push_back((nonce.to_string(), now));
        true
    }
}

/// One message, as it sits in the relay's queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u8,
    /// Which paired device sent this.
    pub id: String,
    /// Rises with every message that device sends; never reused.
    pub seq: u64,
    /// Unix seconds, as the sender saw them.
    pub ts: i64,
    pub nonce: String,
    pub ct: String,
}

/// Why an envelope was thrown away. Kept apart from `AppError` so the tests can say exactly which
/// check caught it; the user-facing text says little on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenError {
    /// From a newer (or older) protocol than this build speaks.
    Version,
    /// Sealed for, or by, a device this channel doesn't know.
    WrongDevice,
    /// A sequence number we have already accepted: a replay.
    Replay,
    /// Too far from our clock in either direction.
    Stale,
    /// Nonce or ciphertext isn't valid base64.
    Malformed,
    /// The tag didn't verify: the wrong key, or something was changed in flight.
    Tampered,
}

impl OpenError {
    fn reason(self) -> &'static str {
        match self {
            Self::Version => "it uses a different version of the remote-control format",
            Self::WrongDevice => "it came from a device that isn't paired",
            Self::Replay => "it repeats a message that was already handled",
            Self::Stale => "its clock is more than five minutes away from this computer's",
            Self::Malformed => "it isn't formed correctly",
            Self::Tampered => "it couldn't be unlocked with this phone's key",
        }
    }
}

impl From<OpenError> for AppError {
    fn from(e: OpenError) -> Self {
        AppError::new(
            ErrorKind::AuthFailed,
            format!(
                "A remote-control message was ignored because {}.",
                e.reason()
            ),
        )
    }
}

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// The 256-bit secret shared by this computer and one phone.
///
/// It is generated here, shown once in a QR code, and otherwise lives in the OS keychain. It is
/// never written to `settings.json`, never logged, and never sent to the relay -- `Debug` prints
/// nothing of it, so it can't leak through an error that happens to carry a device record.
#[derive(Clone)]
pub struct PairingKey([u8; KEY_BYTES]);

impl std::fmt::Debug for PairingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PairingKey(hidden)")
    }
}

impl PairingKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; KEY_BYTES];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    /// Reads the form that goes in the QR code and the keychain.
    pub fn from_b64(s: &str) -> Result<Self, OpenError> {
        let raw = b64().decode(s.trim()).map_err(|_| OpenError::Malformed)?;
        let bytes: [u8; KEY_BYTES] = raw.try_into().map_err(|_| OpenError::Malformed)?;
        Ok(Self(bytes))
    }

    /// For the QR code and the keychain only. Never for a log or an error message.
    pub fn to_b64(&self) -> String {
        b64().encode(self.0)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(&self.0.into())
    }

    /// A value derived from this key and nothing else, for `purpose`.
    ///
    /// Both ends compute these from the key they already share, so neither has to be told them and
    /// they can always be worked out again -- which is what makes a pairing survive the relay
    /// forgetting everything. Each purpose gives an unrelated value, and none of them reveals the
    /// key: HMAC is one-way.
    fn derive(&self, purpose: &str, bytes: usize) -> String {
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(&self.0).expect("HMAC takes any key length");
        mac.update(purpose.as_bytes());
        b64().encode(&mac.finalize().into_bytes()[..bytes.min(32)])
    }

    /// The relay channel this pairing uses. 128 bits: not guessable, and short enough for a URL.
    pub fn channel_id(&self) -> String {
        self.derive("gitpilot/relay/channel", 16)
    }

    /// This computer's secret for that channel.
    pub fn pc_secret(&self) -> String {
        self.derive("gitpilot/relay/secret/pc", 18)
    }

    /// The phone's secret for that channel. Different from the computer's, so neither side can
    /// drain the mailbox it writes into.
    pub fn phone_secret(&self) -> String {
        self.derive("gitpilot/relay/secret/phone", 18)
    }

    /// The phone's device id, as it appears in every envelope it sends.
    pub fn device_id(&self) -> String {
        format!("d{}", self.derive("gitpilot/device", 9))
    }
}

/// What the tag covers besides the ciphertext: everything the relay could otherwise swap.
fn associated_data(v: u8, id: &str, seq: u64, ts: i64) -> Vec<u8> {
    format!("{v}:{id}:{seq}:{ts}").into_bytes()
}

/// Seals one message from this device. `seq` must be higher than any this device sent before.
pub fn seal(key: &PairingKey, device: &str, seq: u64, ts: i64, plaintext: &[u8]) -> Envelope {
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let aad = associated_data(PROTOCOL_VERSION, device, seq, ts);
    let ct = key
        .cipher()
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        // Only fails if the message is near-infinite; a command never is.
        .expect("AES-GCM encryption of a small message cannot fail");
    Envelope {
        v: PROTOCOL_VERSION,
        id: device.to_string(),
        seq,
        ts,
        nonce: b64().encode(nonce_bytes),
        ct: b64().encode(ct),
    }
}

/// Checks and opens one envelope.
///
/// `device` is who we expect to hear from, `guard` remembers what has already been accepted from
/// it, and `now` is this computer's clock. The cheap checks run first; the key is only used once
/// the envelope is worth the work.
pub fn open(
    key: &PairingKey,
    env: &Envelope,
    device: &str,
    guard: &mut ReplayGuard,
    now: i64,
) -> Result<Vec<u8>, OpenError> {
    if env.v != PROTOCOL_VERSION {
        return Err(OpenError::Version);
    }
    if env.id != device {
        return Err(OpenError::WrongDevice);
    }
    if (env.ts - now).abs() > MAX_CLOCK_SKEW_SECS {
        return Err(OpenError::Stale);
    }
    if !guard.accept(&env.nonce, now) {
        return Err(OpenError::Replay);
    }
    let nonce = b64().decode(&env.nonce).map_err(|_| OpenError::Malformed)?;
    if nonce.len() != NONCE_BYTES {
        return Err(OpenError::Malformed);
    }
    let ct = b64().decode(&env.ct).map_err(|_| OpenError::Malformed)?;
    let aad = associated_data(env.v, &env.id, env.seq, env.ts);
    key.cipher()
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ct,
                aad: &aad,
            },
        )
        .map_err(|_| OpenError::Tampered)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE: &str = "phone-1";
    const NOW: i64 = 1_763_300_000;

    fn sealed(key: &PairingKey, body: &str) -> Envelope {
        seal(key, DEVICE, 1, NOW, body.as_bytes())
    }

    #[test]
    fn a_sealed_message_comes_back_unchanged() {
        let key = PairingKey::generate();
        let env = sealed(&key, r#"{"cmd":"status"}"#);

        let out = open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).expect("opens");
        assert_eq!(out, br#"{"cmd":"status"}"#);
    }

    #[test]
    fn the_relay_sees_nothing_readable() {
        let key = PairingKey::generate();
        let env = sealed(&key, "pull the main branch");

        let wire = serde_json::to_string(&env).unwrap();
        assert!(!wire.contains("pull"));
        assert!(!wire.contains(&key.to_b64()));
        // Only the routing fields are in the clear.
        assert!(wire.contains("\"id\":\"phone-1\""));
    }

    #[test]
    fn a_key_never_prints_itself() {
        let key = PairingKey::generate();
        assert_eq!(format!("{key:?}"), "PairingKey(hidden)");
    }

    #[test]
    fn a_key_survives_the_qr_code_round_trip() {
        let key = PairingKey::generate();
        let same = PairingKey::from_b64(&key.to_b64()).expect("decodes");

        let env = sealed(&key, "hello");
        assert_eq!(
            open(&same, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn a_short_or_invalid_key_is_refused() {
        assert_eq!(
            PairingKey::from_b64("not base64!!").unwrap_err(),
            OpenError::Malformed
        );
        assert_eq!(
            PairingKey::from_b64("aGVsbG8").unwrap_err(),
            OpenError::Malformed
        );
    }

    #[test]
    fn another_key_cannot_open_it() {
        let env = sealed(&PairingKey::generate(), "secret");

        let err = open(
            &PairingKey::generate(),
            &env,
            DEVICE,
            &mut ReplayGuard::new(),
            NOW,
        )
        .unwrap_err();
        assert_eq!(err, OpenError::Tampered);
    }

    #[test]
    fn changed_ciphertext_is_refused() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "stage everything");

        let mut raw = b64().decode(&env.ct).unwrap();
        raw[0] ^= 0x01;
        env.ct = b64().encode(raw);

        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Tampered
        );
    }

    #[test]
    fn the_sequence_number_cannot_be_rewritten() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");

        // The relay could renumber a message it kept, to slip it past the replay check.
        env.seq = 99;

        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Tampered
        );
    }

    #[test]
    fn the_timestamp_cannot_be_rewritten() {
        let key = PairingKey::generate();
        let mut env = seal(&key, DEVICE, 1, NOW - 10_000, b"push");

        // Freshening an old message to get it past the clock check.
        env.ts = NOW;

        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Tampered
        );
    }

    #[test]
    fn a_message_cannot_be_moved_to_another_device() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");
        env.id = "phone-2".to_string();

        assert_eq!(
            open(&key, &env, "phone-2", &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Tampered
        );
    }

    #[test]
    fn a_message_from_an_unknown_device_is_refused() {
        let key = PairingKey::generate();
        let env = sealed(&key, "push");

        assert_eq!(
            open(&key, &env, "phone-2", &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::WrongDevice
        );
    }

    #[test]
    fn a_replayed_message_is_refused() {
        let key = PairingKey::generate();
        let env = seal(&key, DEVICE, 7, NOW, b"push");
        let mut guard = ReplayGuard::new();

        assert!(open(&key, &env, DEVICE, &mut guard, NOW).is_ok());
        // The same message again, however it is renumbered, is refused.
        assert_eq!(
            open(&key, &env, DEVICE, &mut guard, NOW).unwrap_err(),
            OpenError::Replay
        );
    }

    #[test]
    fn a_phone_that_lost_its_counter_can_still_be_heard() {
        // The reason this isn't a counter any more. A phone with its site data cleared starts
        // numbering from one again; under the old rule every message it ever sent after that was
        // "a replay", and the pairing was dead with no way back but scanning a new code.
        let key = PairingKey::generate();
        let mut guard = ReplayGuard::new();

        assert!(open(
            &key,
            &seal(&key, DEVICE, 900, NOW, b"a"),
            DEVICE,
            &mut guard,
            NOW
        )
        .is_ok());
        assert!(open(
            &key,
            &seal(&key, DEVICE, 1, NOW, b"b"),
            DEVICE,
            &mut guard,
            NOW
        )
        .is_ok());
    }

    #[test]
    fn the_guard_forgets_what_the_clock_window_has_passed() {
        // It only has to remember as far back as a stale message would be refused anyway, so it
        // cannot keep growing on a computer that is left running for weeks.
        let key = PairingKey::generate();
        let mut guard = ReplayGuard::new();

        assert!(open(
            &key,
            &seal(&key, DEVICE, 1, NOW, b"a"),
            DEVICE,
            &mut guard,
            NOW
        )
        .is_ok());
        assert_eq!(guard.seen.len(), 1);

        // Long enough later that the first one could no longer be used anyway.
        let later = NOW + MAX_CLOCK_SKEW_SECS + 1;
        assert!(open(
            &key,
            &seal(&key, DEVICE, 2, later, b"b"),
            DEVICE,
            &mut guard,
            later
        )
        .is_ok());

        assert_eq!(
            guard.seen.len(),
            1,
            "the one outside the window should have been dropped"
        );
    }

    #[test]
    fn an_old_or_future_message_is_refused() {
        let key = PairingKey::generate();

        let old = seal(&key, DEVICE, 1, NOW - MAX_CLOCK_SKEW_SECS - 1, b"push");
        assert_eq!(
            open(&key, &old, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Stale
        );

        let future = seal(&key, DEVICE, 1, NOW + MAX_CLOCK_SKEW_SECS + 1, b"push");
        assert_eq!(
            open(&key, &future, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Stale
        );

        // A phone whose clock is a little off still works.
        let skewed = seal(&key, DEVICE, 1, NOW - MAX_CLOCK_SKEW_SECS + 1, b"push");
        assert!(open(&key, &skewed, DEVICE, &mut ReplayGuard::new(), NOW).is_ok());
    }

    #[test]
    fn another_protocol_version_is_refused() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");
        env.v = PROTOCOL_VERSION + 1;

        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Version
        );
    }

    #[test]
    fn a_broken_envelope_is_refused_before_the_key_is_used() {
        let key = PairingKey::generate();

        let mut env = sealed(&key, "push");
        env.nonce = "not base64!!".to_string();
        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Malformed
        );

        let mut env = sealed(&key, "push");
        env.nonce = b64().encode([0u8; 4]); // right encoding, wrong length
        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Malformed
        );

        let mut env = sealed(&key, "push");
        env.ct = "not base64!!".to_string();
        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap_err(),
            OpenError::Malformed
        );
    }

    #[test]
    fn two_messages_never_share_a_nonce() {
        let key = PairingKey::generate();
        let a = seal(&key, DEVICE, 1, NOW, b"push");
        let b = seal(&key, DEVICE, 2, NOW, b"push");

        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ct, b.ct);
    }

    #[test]
    fn a_whole_status_snapshot_fits() {
        let key = PairingKey::generate();
        let big = "x".repeat(60 * 1024);

        let env = seal(&key, DEVICE, 1, NOW, big.as_bytes());
        assert_eq!(
            open(&key, &env, DEVICE, &mut ReplayGuard::new(), NOW).unwrap(),
            big.as_bytes()
        );
    }

    /// A real envelope produced by the phone app's WebCrypto code (`remote/src/crypto.ts`), with
    /// a fixed key and nonce. If either side ever drifts -- a different cipher, a different
    /// associated-data string, a different base64 alphabet -- this stops opening, which is much
    /// easier to understand than a phone that silently never connects.
    #[test]
    fn it_opens_an_envelope_the_phone_app_actually_made() {
        let key = PairingKey::from_b64("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8").unwrap();
        let from_webcrypto = r#"{"v":1,"id":"phone","seq":7,"ts":1763300000,"nonce":"ZGVmZ2hpamtsbW5v","ct":"Mzm9Cx3LbLxSCyyc-BgCdRAeH1ETa_v9Fm29NK-f"}"#;

        let env: Envelope = serde_json::from_str(from_webcrypto).unwrap();
        let plain = open(&key, &env, "phone", &mut ReplayGuard::new(), 1_763_300_000).unwrap();

        assert_eq!(String::from_utf8(plain).unwrap(), r#"{"cmd":"list"}"#);
    }

    #[test]
    #[ignore = "prints a vector for the phone app's tests; run with --ignored when the format changes"]
    fn print_vector_for_the_phone_app() {
        let key = PairingKey::from_b64("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8").unwrap();
        let reply = r#"{"ok":true,"message":"2 repositories","kind":null,"detail":null,"data":[]}"#;
        let env = seal(&key, "phone~pc", 3, 1_763_300_000, reply.as_bytes());
        println!("VECTOR {}", serde_json::to_string(&env).unwrap());
    }

    #[test]
    fn everything_about_a_channel_comes_from_the_key() {
        let key = PairingKey::generate();

        // Same key, same values -- that is what lets a pairing be rebuilt from nothing.
        let same = PairingKey::from_b64(&key.to_b64()).unwrap();
        assert_eq!(key.channel_id(), same.channel_id());
        assert_eq!(key.pc_secret(), same.pc_secret());
        assert_eq!(key.device_id(), same.device_id());

        // Another key shares none of them.
        let other = PairingKey::generate();
        assert_ne!(key.channel_id(), other.channel_id());
        assert_ne!(key.pc_secret(), other.pc_secret());
    }

    #[test]
    fn the_two_secrets_are_different_and_dont_give_away_the_key() {
        let key = PairingKey::generate();

        assert_ne!(key.pc_secret(), key.phone_secret());
        assert_ne!(key.channel_id(), key.pc_secret());
        for value in [
            key.channel_id(),
            key.pc_secret(),
            key.phone_secret(),
            key.device_id(),
        ] {
            assert!(!key.to_b64().contains(&value));
            assert!(!value.contains(&key.to_b64()));
        }
    }

    #[test]
    fn derived_values_fit_what_the_relay_accepts() {
        // The relay wants 16-64 characters of letters, digits, - and _.
        let key = PairingKey::generate();
        for value in [key.channel_id(), key.pc_secret(), key.phone_secret()] {
            assert!(
                (16..=64).contains(&value.len()),
                "{value} is {} long",
                value.len()
            );
            assert!(
                value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "{value}"
            );
        }
    }

    #[test]
    fn a_known_key_derives_known_values() {
        // Pins the derivation: the phone app computes these with WebCrypto and must agree, or a
        // paired phone would quietly rebuild a different channel and never be heard from again.
        let key = PairingKey::from_b64("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8").unwrap();

        assert_eq!(key.channel_id(), "hjoZLkFtPEWsTJb6iHtLhg");
        assert_eq!(key.pc_secret(), "h1EYZeUoYGC_hJ1Gp0lSQ6zI");
        assert_eq!(key.phone_secret(), "FCWHXj2LrPJ7_q0i1qX5ppW_");
        assert_eq!(key.device_id(), "d3Dhez5C6LKhp");
    }

    #[test]
    fn the_user_facing_error_says_why_without_saying_how() {
        let err: AppError = OpenError::Replay.into();
        assert_eq!(err.kind, ErrorKind::AuthFailed);
        assert!(err.message.contains("already handled"));
        assert!(err.detail.is_none());
    }
}
