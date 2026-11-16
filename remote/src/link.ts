// The pairing this phone holds, and how it gets here.
//
// Everything arrives in the URL fragment, which the browser never sends to a server -- so the
// site hosting this page never sees the key, and neither does anything in between. The fragment
// is read once, saved, and wiped from the address bar straight away so it can't end up in a
// screenshot, a shared link or the back button.

export type Link = {
  /** The relay channel. */
  channel: string;
  /** This phone's secret for that channel (the computer keeps a different one). */
  secret: string;
  /** The pairing key, base64url. */
  key: string;
  /** This phone's device id, as it appears in every envelope it sends. */
  device: string;
};

const STORAGE_KEY = "gitpilot.remote.link";
const SEQ_OUT = "gitpilot.remote.seqOut";
const SEQ_IN = "gitpilot.remote.seqIn";

/** The id the computer seals its answers under. Mirrors `pc_id` in the desktop. */
export function computerId(link: Link): string {
  return `${link.device}~pc`;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Private mode, or storage turned off.
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the session still works, it just won't survive a reload.
  }
}

/** Reads a pairing out of `#i=…&s=…&k=…&d=…`, if this page was opened from a QR code. */
export function linkFromFragment(fragment: string): Link | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const channel = params.get("i");
  const secret = params.get("s");
  const key = params.get("k");
  const device = params.get("d");
  if (!channel || !secret || !key || !device) return null;
  return { channel, secret, key, device };
}

/**
 * The pairing this phone should use: a fresh one from the address bar if there is one, otherwise
 * whatever was stored last time. A new pairing replaces the old one and resets the counters.
 */
export function loadLink(): Link | null {
  const fresh = linkFromFragment(window.location.hash);
  if (fresh) {
    write(STORAGE_KEY, JSON.stringify(fresh));
    write(SEQ_OUT, "0");
    write(SEQ_IN, "0");
    // Drop the key from the address bar immediately, without adding a history entry.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return fresh;
  }
  const stored = read(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Link;
    return parsed.channel && parsed.secret && parsed.key && parsed.device ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetLink() {
  for (const key of [STORAGE_KEY, SEQ_OUT, SEQ_IN]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore: the page is about to reload anyway.
    }
  }
}

/** The next sequence number to send. Must never repeat, or the computer treats it as a replay. */
export function nextSeqOut(): number {
  const next = Number(read(SEQ_OUT) ?? "0") + 1;
  write(SEQ_OUT, String(next));
  return next;
}

export function lastSeqIn(): number {
  return Number(read(SEQ_IN) ?? "0");
}

export function noteSeqIn(seq: number) {
  write(SEQ_IN, String(Math.max(seq, lastSeqIn())));
}
