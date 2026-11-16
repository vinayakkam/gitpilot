# PLAN — 0.7.0 remote control (temporary working file, not for commit)

Written 2026-11-14. Delete before the release commit, or fold into `docs/REMOTE_CONTROL.md`.
Nothing in this plan has been built yet.

## Decisions taken with the user (this session)

| Question | Decision |
|---|---|
| What is 0.7.0 | Remote control from the phone (`plan.md`'s "safety and understanding" items move to 0.8.0) |
| Must it work off the home network | **Yes** — phone at college, PC at home is the main case |
| GitHub token on the phone | **No.** Ruled out by the user. The gist-mailbox design in `docs/REMOTE_CONTROL.md` is dead |
| How the phone reaches the PC | A relay the user owns: `api.olittechnologies.co.in`, inside the existing Flask app (`vinayakkam/my-discord-bot`, `keep_alive.py`) |
| That repo is public | Fine: no secret lives in the relay's code. See "Why public code is safe" |
| Pairing | QR shown in GitPilot, scanned with the phone's normal camera app (not an in-page camera) |
| Phone can | status, one file's diff, stage/unstage, commit, fetch, pull, push. Push needs a confirm tap. Never a force push |
| Release size | Everything (relay + desktop + settings UI + phone web app) ships as 0.7.0 |
| Phone app address | `https://olittechnologies.co.in/remote/`, served from `vinayakkam/OLIT.github.io` (already has `CNAME`, HTTPS, no build step) |
| Publishing the phone app | `npm run build:remote` → `dist-remote/`, then `node scripts/publish-remote.mjs <path to OLIT.github.io>` copies it into that repo's `remote/`; the user commits and pushes there. **No deploy token anywhere** |
| Host constraints | EnderCloud: 720 MiB RAM (34.56 MiB in use), 3 GiB disk. The relay must be tiny |
| Attribution | No co-author / "generated with" lines in commits or PRs |

## Architecture

Both ends only make **outbound** HTTPS calls, so no port forwarding, no public IP, no firewall changes.

```
Phone (college)                        api.olittechnologies.co.in            GitPilot (home PC)
olittechnologies.co.in/remote/   POST /remote/send   (sealed command)  →  GET  /remote/poll
   holds pairing key              GET  /remote/poll  (sealed result)   ←  POST /remote/send
                                   relay sees only ciphertext                holds pairing key
```

- The relay routes opaque blobs between two device ids and forgets them. It cannot read, replay or
  forge anything.
- GitPilot polls every **3 s** while a phone has been active in the last 5 minutes, **15 s** otherwise.
- Expect 2–4 s from tap to result.

### Pairing (no accounts, no tokens, nothing typed)

1. Settings → Remote control → Turn on. GitPilot calls `POST /remote/register` and gets a **relay id**
   (random, ~16 chars) plus a **relay secret** (used only to prove it owns that id when polling).
2. GitPilot generates a 256-bit **pairing key** and shows a QR for
   `https://olittechnologies.co.in/remote/#i=<relay id>&k=<base64url pairing key>`.
   The fragment (`#…`) is never sent to any server — not to GitHub Pages, not to the relay.
3. The phone's camera app opens that URL. The page reads the fragment, stores id + key in
   `localStorage`, immediately rewrites the URL to drop the fragment, and sends a sealed `hello`.
4. GitPilot shows "Phone paired" and the device appears in Settings with a name, paired-at and
   last-seen. Remove forgets the key and tells the relay to drop the id.

### Crypto

- **AES-256-GCM** both sides: WebCrypto on the phone (built in, no library), the `aes-gcm` crate on
  the desktop. Chosen over XChaCha20 because the browser has it natively.
- Envelope: `{v, id, seq, ts, nonce, ct}`. `id`, `seq`, `ts` are the AAD, so they can't be swapped.
- 96-bit random nonce per message.
- **Replay/stale protection:** `seq` must be strictly greater than the last seen for that device, and
  `ts` within 5 minutes of now. Both sides keep their own counters; the desktop's survive restarts
  (stored with the device record).
- Keys in the OS keychain (`secrets.rs`), never in `settings.json`, never in a log, never in the QR
  image's file name or the clipboard.

### Why public code is safe

Security rests on the pairing key, which is generated on the PC and reaches only the phone. Publishing
the relay's source tells an attacker the message format and lets them see sealed blobs. Worst case for
a public endpoint is **abuse of the user's bandwidth**, not access to the machine — hence the caps below.

## Phase 1 — the relay (`vinayakkam/my-discord-bot`, public, low RAM)

New blueprint, ~200 lines, registered from `keep_alive.py`. **No new pip packages, no DB, no disk
writes, no WebSockets, no long-poll** (either would pin a worker thread per device).

| Endpoint | Does |
|---|---|
| `POST /remote/register` | Issues `{id, secret}`. Rate-limited hard per IP |
| `POST /remote/send` | Appends one sealed message to an id's queue. Needs the sender's secret for its own id |
| `GET /remote/poll?id=&since=` | Returns messages after `since` and deletes them. Needs the secret |
| `POST /remote/unregister` | Drops the id and its queue |

Caps (the whole point on a 720 MiB box):

- ≤ **16 messages per id**, ≤ **64 KiB each**, global ceiling **2 MiB** (oldest dropped at the cap).
- Messages expire after **5 minutes**; ids with no poll for **1 hour** are dropped.
- Per-id and per-IP rate limits answer **429** instead of queueing.
- `REMOTE_RELAY_ENABLED=0` kills just this feature and leaves the bot running.
- No payload or id logging. CORS: add only the existing site origin.

Tests in that repo's `tests/` (it has pytest): queue caps, expiry, wrong secret, oversized body,
rate limit, kill switch.

**The user deploys this** by pushing that repo, the way they already deploy the bot.

## Phase 2 — desktop (`src-tauri/src/remote/`)

- `crypto.rs` — seal/open, nonce, AAD, `seq`/clock checks. Unit tests: tampered ciphertext, replayed
  `seq`, stale `ts`, wrong key, wrong device.
- `relay.rs` — register/send/poll client with backoff; adaptive interval; gives up quietly offline.
- `dispatch.rs` — maps a command onto the existing `Repo` functions. **No new git code paths**, same
  per-repo mutex, everything outbound through `redact.rs`.
- Commands allowed, and nothing else: `status`, `diff` (one file, ≤64 KiB, sensitive-name files
  refused exactly as AI does), `fetch`, `pull`, `push` (never force; requires `confirmed: true`),
  `stage`, `unstage`, `commit`. Repos addressed by **repo id**, paths validated as today.
- `settings.remote`: `{ enabled: false, devices: [{id, name, pairedAt, lastSeen, seq}] }`.
- New Tauri commands: `remote_status`, `remote_enable`, `remote_disable`, `remote_pair_start`,
  `remote_device_remove`. Bindings regenerated with `cargo test`.
- Integration tests on temp repos for dispatch; relay client against a mock HTTP server.

## Phase 3 — Settings → Remote control (React)

On/off; the QR as inline SVG (small hand-rolled encoder, no dependency); paired phones with Remove;
last-activity list; plain-language note on what a phone can and cannot do; "needs GitPilot running".

## Phase 4 — the phone app (`remote/` → `olittechnologies.co.in/remote/`)

React + TS + Vite, `base: '/remote/'`, hash routing, built to `dist-remote/`. Repository list, status,
changed files, one file's diff, stage/unstage, commit box, Fetch/Pull/Push with a confirm sheet on
push, results with the same plain-language errors the desktop shows, installable PWA, notifications
while open. Mobile-first, same tokens as the desktop.

`scripts/publish-remote.mjs` copies the build into the site repo's `remote/` and prints what changed.
`olittechnologies.co.in/remote/` with no pairing in storage shows a short "how to connect" page.

## Phase 5 — release

Rewrite `docs/REMOTE_CONTROL.md` to this design (the gist design is gone), update `plan.md` (0.7.0 is
remote control; safety items → 0.8.0), README, INSTALL, CHANGELOG, DEVELOPMENT (session 15 entry,
feature tracker, known issues). Version 0.7.0 in `package.json`, `Cargo.toml`, `tauri.conf.json`,
`packaging/arch/PKGBUILD`. Branch `release/0.7.0`, full checks, push, PR, merge, tag `v0.7.0`, let CI
build the installers. No co-author lines.

## Checks that must pass before each commit

`npm run typecheck`, `npm run lint`, `npm test`, and in `src-tauri/`: `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings`, `cargo test`.

**New this session: Rust is now installed on this Windows machine** (rustup + stable 1.100, MSVC build
tools were already there). Baseline before any change: `cargo test` → 189 unit + 30 integration
passed, 2 ignored. This is the first time the backend has been buildable here.

## Working tree right now (uncommitted, nothing pushed)

1. `src/features/history/HistoryView.tsx` + `src/features/history/HistoryView.test.tsx` — **fix for the
   bug in the screenshot**: switching repository kept the previous repository's selected commit, so the
   details pane asked the new repository for a hash it never had →
   `fatal: bad object 971851e3b3a6d4905abe6b4a31a3fecf0aa0b6f9` (that hash is from the Discord Bot
   repo). Also, the error never cleared afterwards.
   - Done: `commitsRepo` state records which repository `commits` came from; the detail and diff
     effects wait for `commitsRepo === id`; the selection resets on repository change; `detailErr`
     and `diffErr` are cleared when the selection goes away.
   - A first attempt adjusted state during render — React discarded the update; replaced.
   - **Still failing:** the new test sees one call `commitGet(2, <repo-1 hash>)` slipping through
     before `commitsRepo` catches up. Next step: have `load()` clear `commits`/`commitsRepo` as soon
     as it starts for a different repository (or key the selection to the repository), then re-run
     `npx vitest run src/features/history/HistoryView.test.tsx`.
2. `docs/REMOTE_CONTROL.md` — "open questions" replaced with decisions + a publishing section. **Now
   out of date**: it still describes the GitHub gist mailbox, which has been dropped. Rewrite in phase 5.
3. `PLAN-0.7.0.md` — this file.

## Open for the user

- Deploy the relay to EnderCloud when phase 1 lands, and confirm `api.olittechnologies.co.in/remote/…`
  answers from outside the home network.
- A name for the feature in the UI ("Remote control" is assumed).
- Later: whether the Android app (0.7.x) is worth an OAuth client ID, or whether the PWA is enough.
