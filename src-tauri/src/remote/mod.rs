//! Remote control: driving GitPilot from a paired phone.
//!
//! The phone and this computer never talk directly. Both make outbound HTTPS calls to a small
//! relay (`api.olittechnologies.co.in`), which routes sealed blobs between them and forgets them
//! -- so there is no port to open at home, and nothing of the user's reaches a third party in a
//! readable form. The relay's own source is public; see `crypto` for why that is safe.
//!
//! * `crypto` -- the sealed envelope, with the replay and clock checks.
//! * `relay`  -- the HTTP client for the post box, its polling pace and its backoff.
//! * `dispatch` -- the short list of things a phone may ask for, onto the app's own functions.
//! * `service`  -- pairing, and the loop that listens for a paired phone.
//!
//! Off by default. Pairing is a QR code shown on this computer and scanned by the phone, so no
//! account, token or password is involved anywhere in the feature.

pub mod crypto;
pub mod dispatch;
pub mod relay;
pub mod service;
