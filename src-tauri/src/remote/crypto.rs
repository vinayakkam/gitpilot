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
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorKind};

/// Bumped only if the format changes in a way an older phone can't read.
pub const PROTOCOL_VERSION: u8 = 1;

pub const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;

/// How far apart the two clocks may be. Generous enough for a phone that never syncs its time,
/// short enough that a command recorded off the relay is useless later.
pub const MAX_CLOCK_SKEW_SECS: i64 = 300;

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
            format!("A remote-control message was ignored because {}.", e.reason()),
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
/// `device` is who we expect to hear from, `last_seq` the highest sequence number already
/// accepted from it (0 when it has sent nothing yet), and `now` this computer's clock. The cheap
/// checks run first; the key is only used once the envelope is worth the work.
pub fn open(
    key: &PairingKey,
    env: &Envelope,
    device: &str,
    last_seq: u64,
    now: i64,
) -> Result<Vec<u8>, OpenError> {
    if env.v != PROTOCOL_VERSION {
        return Err(OpenError::Version);
    }
    if env.id != device {
        return Err(OpenError::WrongDevice);
    }
    if env.seq <= last_seq {
        return Err(OpenError::Replay);
    }
    if (env.ts - now).abs() > MAX_CLOCK_SKEW_SECS {
        return Err(OpenError::Stale);
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

        let out = open(&key, &env, DEVICE, 0, NOW).expect("opens");
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
        assert_eq!(open(&same, &env, DEVICE, 0, NOW).unwrap(), b"hello");
    }

    #[test]
    fn a_short_or_invalid_key_is_refused() {
        assert_eq!(PairingKey::from_b64("not base64!!").unwrap_err(), OpenError::Malformed);
        assert_eq!(PairingKey::from_b64("aGVsbG8").unwrap_err(), OpenError::Malformed);
    }

    #[test]
    fn another_key_cannot_open_it() {
        let env = sealed(&PairingKey::generate(), "secret");

        let err = open(&PairingKey::generate(), &env, DEVICE, 0, NOW).unwrap_err();
        assert_eq!(err, OpenError::Tampered);
    }

    #[test]
    fn changed_ciphertext_is_refused() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "stage everything");

        let mut raw = b64().decode(&env.ct).unwrap();
        raw[0] ^= 0x01;
        env.ct = b64().encode(raw);

        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Tampered);
    }

    #[test]
    fn the_sequence_number_cannot_be_rewritten() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");

        // The relay could renumber a message it kept, to slip it past the replay check.
        env.seq = 99;

        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Tampered);
    }

    #[test]
    fn the_timestamp_cannot_be_rewritten() {
        let key = PairingKey::generate();
        let mut env = seal(&key, DEVICE, 1, NOW - 10_000, b"push");

        // Freshening an old message to get it past the clock check.
        env.ts = NOW;

        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Tampered);
    }

    #[test]
    fn a_message_cannot_be_moved_to_another_device() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");
        env.id = "phone-2".to_string();

        assert_eq!(open(&key, &env, "phone-2", 0, NOW).unwrap_err(), OpenError::Tampered);
    }

    #[test]
    fn a_message_from_an_unknown_device_is_refused() {
        let key = PairingKey::generate();
        let env = sealed(&key, "push");

        assert_eq!(open(&key, &env, "phone-2", 0, NOW).unwrap_err(), OpenError::WrongDevice);
    }

    #[test]
    fn a_replayed_message_is_refused() {
        let key = PairingKey::generate();
        let env = seal(&key, DEVICE, 7, NOW, b"push");

        assert!(open(&key, &env, DEVICE, 6, NOW).is_ok());
        // Once 7 is accepted it can never be used again, nor anything below it.
        assert_eq!(open(&key, &env, DEVICE, 7, NOW).unwrap_err(), OpenError::Replay);
        assert_eq!(open(&key, &env, DEVICE, 99, NOW).unwrap_err(), OpenError::Replay);
    }

    #[test]
    fn an_old_or_future_message_is_refused() {
        let key = PairingKey::generate();

        let old = seal(&key, DEVICE, 1, NOW - MAX_CLOCK_SKEW_SECS - 1, b"push");
        assert_eq!(open(&key, &old, DEVICE, 0, NOW).unwrap_err(), OpenError::Stale);

        let future = seal(&key, DEVICE, 1, NOW + MAX_CLOCK_SKEW_SECS + 1, b"push");
        assert_eq!(open(&key, &future, DEVICE, 0, NOW).unwrap_err(), OpenError::Stale);

        // A phone whose clock is a little off still works.
        let skewed = seal(&key, DEVICE, 1, NOW - MAX_CLOCK_SKEW_SECS + 1, b"push");
        assert!(open(&key, &skewed, DEVICE, 0, NOW).is_ok());
    }

    #[test]
    fn another_protocol_version_is_refused() {
        let key = PairingKey::generate();
        let mut env = sealed(&key, "push");
        env.v = PROTOCOL_VERSION + 1;

        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Version);
    }

    #[test]
    fn a_broken_envelope_is_refused_before_the_key_is_used() {
        let key = PairingKey::generate();

        let mut env = sealed(&key, "push");
        env.nonce = "not base64!!".to_string();
        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Malformed);

        let mut env = sealed(&key, "push");
        env.nonce = b64().encode([0u8; 4]); // right encoding, wrong length
        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Malformed);

        let mut env = sealed(&key, "push");
        env.ct = "not base64!!".to_string();
        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap_err(), OpenError::Malformed);
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
        assert_eq!(open(&key, &env, DEVICE, 0, NOW).unwrap(), big.as_bytes());
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
        let plain = open(&key, &env, "phone", 6, 1_763_300_000).unwrap();

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
    fn the_user_facing_error_says_why_without_saying_how() {
        let err: AppError = OpenError::Replay.into();
        assert_eq!(err.kind, ErrorKind::AuthFailed);
        assert!(err.message.contains("already handled"));
        assert!(err.detail.is_none());
    }
}
