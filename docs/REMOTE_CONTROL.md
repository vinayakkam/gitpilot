# Remote control (planned for 0.7.0)

Control GitPilot on your computer from your phone: see what's going on in your repositories,
fetch, pull, push and commit, and get told when something needs you. Works from anywhere, with
no server of our own: **GitHub is the mailbox** between the phone and the computer.

Status: **design agreed with the user on 2026-11-14, not started.** Build starts when the user says so.

## Decisions (agreed 2026-11-14)

| Question | Decision |
|---|---|
| How the phone reaches the computer | Through GitHub, so it works anywhere (no relay server, no open port at home) |
| The phone app | Both: a web app first (0.7.0), a native Android app built with Tauri mobile next (0.7.x) |
| What the phone can do | See status, sync (fetch / pull / push), commit, notifications |

## How it works

```
Phone (web app or Android app)                 GitHub                       Computer (GitPilot)
  signed in to GitHub          ── writes ──▶  secret gist "GitPilot remote"  ◀── polls (ETag) ──  signed in to GitHub
  holds the pairing key                        commands.json  (phone → PC)                        holds the pairing key
                               ◀── reads ───   state.json     (PC → phone)   ── writes ──▶
                                               results.json   (PC → phone)
```

- The desktop creates one **secret gist** per pairing. A secret gist is unlisted, not private, so
  **everything in it is end-to-end encrypted** with a key that never goes to GitHub.
- **Pairing:** Settings → Remote control → Pair a phone shows a QR code with the gist id, a
  device id and a random 256-bit key. The phone scans it (or types a short code). The key lives in
  the OS keychain on the computer and in the app's storage on the phone.
- **Both sides must be signed in to the same GitHub account.** The desktop checks the gist owner
  and the phone's login match the desktop's account before it accepts a command.
- **Encryption:** each message is an envelope `{v, device, seq, ts, nonce, ciphertext}` sealed with
  XChaCha20-Poly1305 (Rust `chacha20poly1305`; the web app uses libsodium.js or WebCrypto AES-GCM —
  pick one cipher for both). The device id and `seq` are in the associated data.
- **Replay protection:** `seq` must go up per device, and `ts` must be within 5 minutes of now.
- **Polling:** the desktop polls the gist every 5 s while remote control is on, with `If-None-Match`
  (unchanged answers are 304s and don't count against GitHub's 5,000 requests an hour). The phone
  polls `state.json` while it's open. Expect 2–10 s from tap to result.
- **Off by default.** Turning it on, pairing and every paired phone are visible in Settings, and a
  phone can be removed (the gist is deleted and the key forgotten) at any time.

## What the phone can ask for

Only these commands, each validated by the desktop exactly like a click in the app. Repositories are
addressed by repo id, never by path. Nothing else runs; there's no "run a command".

| Command | What the desktop does |
|---|---|
| `status` | Refreshes `state.json`: repositories, branch, ahead/behind, changed files (names and kinds, no contents), last 20 commits, the branch's pull request checks and review state |
| `diff` (one file) | Sends that file's diff, size-capped, secrets-pattern files refused (same rules as AI) |
| `fetch`, `pull` | Same as the toolbar: pull is fast-forward only unless the user's setting says otherwise |
| `push` | Normal push only. **Never force push** from the phone. |
| `stage`, `unstage` | Paths validated as today (relative, no `..`, after `--`) |
| `commit` | Message from the phone; never stages on its own; the identity check applies. AI suggestion if AI is on. |

Results go to `results.json` (`ok`, plain message, redacted details) so the phone can show the same
errors the app shows. Fun mode scenes play on the phone too.

## Notifications

- **Android app:** local notifications from a background poll (WorkManager, every 15 minutes, the
  shortest Android allows), plus immediately while the app is open.
- **Web app:** notifications while it's open. Background push (Web Push) needs a push service
  subscription; the desktop could send it directly with VAPID keys, but that is **optional, later**.
- What triggers one: new commits to pull, a push or pull finished or failed, the branch's pull
  request checks failed or a review asked for changes (the same events auto-fetch already detects).

## The phone apps

**Web app (0.7.0).** A static PWA in `remote/` (React + TypeScript, built with Vite into
`dist-remote/`), published with GitHub Pages so it is served over HTTPS (needed for the camera and
notifications). It talks only to `api.github.com`. Sign-in: GitHub's device flow can't be called
from a browser (no CORS), so the web app asks for a **personal access token with only the `gist`
scope** once, with step-by-step help, and keeps it in the browser's storage.

**Android app (0.7.x).** Tauri 2 mobile, same `remote/` UI. It can use the device flow (no CORS
outside the browser), the system keystore for the token and key, and background notifications.
Built in CI as an APK attached to releases; Play Store later.

## Desktop changes

- `src-tauri/src/remote.rs`: gist create/read/write with ETags, envelope encrypt/decrypt, replay
  checks, command dispatch to the existing `Repo` functions (no new git code paths).
- `settings.remote`: on/off, poll interval, paired devices `{id, name, gistId, pairedAt, lastSeen}`.
  Keys in the keychain (`secrets.rs`), never in `settings.json`.
- Settings → Remote control: turn on, Pair a phone (QR), paired phones with Remove, last activity log.
- The GitHub token needs the **`gist` scope** in addition to today's scopes; sign-in asks again when
  it's missing.

## Security notes

- Nothing readable is stored on GitHub: the gist only holds encrypted envelopes.
- A stolen GitHub token alone can't control the computer (no key); a stolen key alone can't reach it
  (no token). Removing a phone deletes its gist and key.
- The phone can't run arbitrary commands, read arbitrary files, force push or change settings.
- Command handling goes through the per-repo lock like any other operation.
- Everything that reaches the phone is redacted the same way the UI is (`redact.rs`).

## Plan

**0.7.0**
1. Envelope format, crypto and replay checks in Rust, with unit tests (tampered, replayed, old, wrong device).
2. Gist mailbox client with ETag polling; integration test against a mocked GitHub API.
3. Command dispatch and `state.json` snapshot, tested on temporary repositories.
4. Settings → Remote control: on/off, pairing QR, devices, activity log; `gist` scope check.
5. Web app `remote/`: token setup, scan QR, repositories, status, file list and diff, fetch/pull/push, stage and commit, results, notifications while open.
6. GitHub Pages workflow for the web app; docs (this file, README, INSTALL).
7. Real test: pair a phone, run every command, kill the network mid-command, remove the phone.

**0.7.x**
8. Tauri Android app from `remote/`: device flow sign-in, keystore, background notifications, APK in CI.
9. Optional: Web Push from the desktop for the web app.

## Open questions for the build session

- Web app address: `vinayakkam.github.io/gitpilot/remote/` or under olittechnologies.co.in.
- Should a commit or push from the phone need a confirmation on the phone? (Proposed: yes for push.)
- The GitHub OAuth app's client ID is needed for the Android device flow (the same one as the desktop).
