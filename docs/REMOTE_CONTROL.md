# Remote control (0.7.0)

Control GitPilot on your computer from your phone: see your repositories, stage and commit, and
fetch, pull or push — from anywhere, with your phone on mobile data and your computer at home.

There is **no account, no token and no password anywhere in this feature**. Pairing is a QR code
shown on the computer and read by the phone's own camera, and that code carries a key the two
devices share and nobody else ever sees.

Status: **built and used end to end** (0.7.0). Off by default.

## How it works

```
Phone (anywhere)                api.olittechnologies.co.in            GitPilot (at home)
olittechnologies.co.in/remote/   POST /remote/send  (sealed command) →  GET  /remote/poll
   holds the pairing key         GET  /remote/poll  (sealed result)  ←  POST /remote/send
                                   the relay sees only ciphertext        holds the pairing key
```

Both sides only ever make **outbound** HTTPS calls, so there is no port to forward, no public IP
and no change to a home router. The relay in the middle is a post box: it holds sealed blobs for
a few minutes and routes them between two devices. It cannot read, forge or replay anything.

### Pairing

1. **Settings → Remote control → Pair a phone.** GitPilot generates a 256-bit key, opens the channel
   that key derives, and shows a QR code for `https://olittechnologies.co.in/remote/#k=<key>`.
2. The phone's camera app opens that link. Everything after the `#` is a **URL fragment**, which
   browsers never send to a server — so the key reaches the page's JavaScript without GitHub Pages,
   the relay, or anything in between ever seeing it.
3. The page saves the pairing, wipes the fragment from the address bar, and says hello.
4. The computer shows "paired", and the phone appears in Settings with its name and last use.

The key lives in the OS keychain on the computer and in the browser's storage on the phone. It is
never in `settings.json`, never logged, never copied to the clipboard.

### Everything else comes from the key

The channel id, each side's secret and the phone's device id are all HMAC-SHA256 of the key with a
different label. That matters because the relay keeps channels **in memory**: it forgets them when
it restarts, and drops any that nobody polls for an hour. Without this, a computer that was off
overnight came back to a channel that no longer existed, and the phone had to be paired again.

Now either end can put the channel back exactly as it was, because both can work out the same
three values. Nobody else can: without the key they are unguessable, and the relay refuses a claim
whose secrets don't match an existing channel's. **A pairing is permanent** — it ends when you
remove the phone, and not before.

### Several computers

A phone holds a list of pairings, one per computer, and switches between them in its toolbar.
Scanning another computer's code adds to that list. Each computer reports its own name (whatever
the operating system calls it), and a dot beside the name shows whether GitPilot is running there,
from how recently it asked the relay for commands.

### Sealing

Every message is one envelope:

```json
{ "v": 1, "id": "<device>", "seq": 12, "ts": 1763300000, "nonce": "<b64url>", "ct": "<b64url>" }
```

- **AES-256-GCM**, chosen because the phone has it natively in WebCrypto — the phone app ships no
  crypto library at all. The desktop uses the `aes-gcm` crate.
- `v`, `id`, `seq` and `ts` are the **associated data**, so the tag covers them: a message cannot be
  renumbered, backdated, or moved to another device.
- **Replays** are refused: `seq` must be higher than the last one accepted from that device, and the
  counter survives a restart.
- **Stale messages** are refused: `ts` must be within five minutes of the receiver's clock.
- The computer answers under a different device id (`<device>~pc`), so an answer can never be posted
  back as if it were a command.

Both implementations are tested against envelopes the *other* one produced, in both directions, so
they cannot drift apart silently.

## What a phone can ask for

Only these. There is no "run a command", no path, and no way to reach a repository that isn't
registered in GitPilot — repositories are addressed by their id in the registry.

| Command | What the computer does |
|---|---|
| `list` | Every registered repository: branch, ahead/behind, how many files changed |
| `open` | One repository: its changed files and its last 20 commits |
| `diff` | One file's changes, size-capped. Files that look like keys or `.env` are refused, exactly as for AI |
| `stage`, `unstage` | Paths validated as always: relative, no `..`, passed after `--` |
| `commit` | Commits what is staged. Never stages for you; the identity check applies |
| `fetch`, `pull` | As the toolbar does — pull follows your own setting, fast-forward only by default |
| `push` | A normal push, and only after a confirmation tap on the phone. **Never a force push** |

Everything runs through the same functions the app's own buttons use, under the same per-repository
lock, and every answer is redacted the way the UI is. A phone can never force push, discard work,
change settings, or read a file outside a diff.

## The relay

A ~340-line Flask blueprint in `vinayakkam/my-discord-bot` (`remote_relay.py`), public source,
running on a 720 MiB host — so it is deliberately tiny: Flask and the standard library only, no
database, no disk writes, no WebSocket and no long-poll.

| Endpoint | Does |
|---|---|
| `POST /remote/register` | Opens a channel, or puts a known one back from `{id, secret, peerSecret}` |
| `POST /remote/send` | Puts one sealed envelope in the other side's mailbox |
| `GET /remote/poll` | Takes everything waiting in the caller's own mailbox |
| `POST /remote/unregister` | Drops a channel and its queues |
| `GET /remote/presence` | How long ago the other side looked for messages (the green dot) |
| `GET /remote/health` | Counts only — no ids, no bodies |

One registration is one channel with two mailboxes (`pc` and `phone`). Each side has its own
secret, always sends into the other's mailbox and polls its own, so one secret can never drain the
queue it writes to.

Caps, because the host is small: 64 KiB per message, 16 messages per mailbox, **2 MiB queued in
total**, 256 channels, messages expire after 5 minutes, channels after an hour without a poll, and
per-IP and per-channel rate limits answer 429 rather than queueing. `REMOTE_RELAY_ENABLED=0` turns
the feature off without touching the bot. No id, secret or payload is ever logged.

**Why public source is safe:** security rests on the pairing key, which is made on the computer and
reaches only the phone. Knowing the message format and seeing sealed blobs gets an attacker
nothing; the worst case for the endpoint is wasted bandwidth, which is what the caps are for.

## Polling and battery

The computer polls every **3 seconds** while a phone has been active in the last five minutes, and
every **15 seconds** otherwise, backing off by doubling up to a minute when the relay is unreachable.
Expect about 2–4 seconds from tap to result.

## The phone app

A static page (React + TypeScript, built with Vite) published to `olittechnologies.co.in/remote/`
from the `vinayakkam/OLIT.github.io` repository. It talks only to the relay, and holds nothing but
the pairing. "Forget this computer" erases it.

```bash
npm run build:remote                       # builds into dist-remote/
npm run publish:remote -- ../OLIT.github.io  # copies it in; you commit and push
```

The publish script never commits, never pushes and holds no token on purpose.

## Removing a phone

Settings → Remote control → Remove. The key is forgotten, the entry goes, and the channel is dropped
from the relay. If the relay can't be reached the phone is still forgotten here — and without the
key the channel is useless to anyone.

## What this still doesn't do

- No notifications on the phone yet: the app shows news while it is open.
- No diff on the phone: the backend will send one file's changes, but the app doesn't show them yet.
- No Android app yet (0.7.x, with Tauri mobile and background notifications).
- GitPilot has to be running on the computer. Nothing is queued while it is closed, and messages
  older than five minutes are dropped by the relay.
