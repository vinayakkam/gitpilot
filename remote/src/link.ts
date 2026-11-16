// The computers this phone is paired with.
//
// A phone can hold several: one app, one list, switch between them. Each pairing is just a key —
// everything else (the relay channel, both secrets, this phone's device id) is derived from it,
// so a pairing is small, and it can always be rebuilt after the relay forgets its channel.
//
// Keys arrive in the URL fragment, which the browser never sends to a server, so the site hosting
// this page never sees one. The fragment is read once, saved, and wiped from the address bar
// straight away so it can't end up in a screenshot, a shared link or the back button.

import { derive } from "./derive";

export type Pairing = {
  /** The pairing key, base64url. The whole secret. */
  key: string;
  /** This phone's device id for that computer. Derived, except for pairings made in 0.7.0. */
  device: string;
  /** What the computer calls itself, once it has told us. */
  computer: string | null;
  addedAt: number;
};

const LINKS = "gitpilot.remote.links";
const ACTIVE = "gitpilot.remote.active";
/** 0.7.0 kept a single pairing under this name. */
const LEGACY = "gitpilot.remote.link";

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
    // The session still works; it just won't survive a reload.
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

function load(): Pairing[] {
  const stored = read(LINKS);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is Pairing => !!p && typeof p.key === "string" && typeof p.device === "string");
  } catch {
    return [];
  }
}

function save(pairings: Pairing[]) {
  write(LINKS, JSON.stringify(pairings));
}

/** Brings a single 0.7.0 pairing into the list, keeping its device id so it still matches. */
function migrateLegacy(): Pairing | null {
  const stored = read(LEGACY);
  if (!stored) return null;
  remove(LEGACY);
  try {
    const old = JSON.parse(stored) as { key?: string; device?: string };
    if (!old.key || !old.device) return null;
    return { key: old.key, device: old.device, computer: null, addedAt: Date.now() };
  } catch {
    return null;
  }
}

/** Reads a pairing out of the address bar: `#k=<key>`, or 0.7.0's `#i=…&s=…&k=…&d=…`. */
export async function pairingFromFragment(fragment: string): Promise<Pairing | null> {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const key = params.get("k");
  if (!key) return null;
  // 0.7.0 put the device id in the code; from 0.7.1 it comes from the key like everything else.
  const device = params.get("d") ?? (await derive(key)).device;
  return { key, device, computer: null, addedAt: Date.now() };
}

/**
 * Every paired computer, newest first, after taking in anything the address bar brought.
 *
 * Scanning a code for a computer that is already here replaces its entry rather than adding a
 * second one, so re-pairing after a reinstall doesn't leave a ghost in the list.
 */
export async function loadPairings(): Promise<Pairing[]> {
  let pairings = load();

  const legacy = migrateLegacy();
  if (legacy && !pairings.some((p) => p.key === legacy.key)) pairings = [legacy, ...pairings];

  const fresh = await pairingFromFragment(window.location.hash);
  if (fresh) {
    pairings = [fresh, ...pairings.filter((p) => p.key !== fresh.key && p.device !== fresh.device)];
    setActive(fresh.device);
    // Drop the key from the address bar at once, without adding a history entry.
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  if (legacy || fresh) save(pairings);
  return pairings;
}

export function activeDevice(): string | null {
  return read(ACTIVE);
}

export function setActive(device: string) {
  write(ACTIVE, device);
}

/** Remembers what a computer calls itself, so the list can show its name rather than "Computer". */
export function noteComputerName(device: string, computer: string) {
  const pairings = load();
  const found = pairings.find((p) => p.device === device);
  if (!found || found.computer === computer) return;
  found.computer = computer;
  save(pairings);
}

export function forget(device: string): Pairing[] {
  const left = load().filter((p) => p.device !== device);
  save(left);
  for (const key of [`gitpilot.remote.seqOut.${device}`, `gitpilot.remote.seqIn.${device}`]) remove(key);
  if (activeDevice() === device) {
    const next = left[0]?.device;
    if (next) setActive(next);
    else remove(ACTIVE);
  }
  return left;
}

/** The next sequence number to send. Must never repeat, or the computer calls it a replay. */
export function nextSeqOut(device: string): number {
  const key = `gitpilot.remote.seqOut.${device}`;
  const next = Number(read(key) ?? "0") + 1;
  write(key, String(next));
  return next;
}

export function lastSeqIn(device: string): number {
  return Number(read(`gitpilot.remote.seqIn.${device}`) ?? "0");
}

export function noteSeqIn(device: string, seq: number) {
  const key = `gitpilot.remote.seqIn.${device}`;
  write(key, String(Math.max(seq, lastSeqIn(device))));
}
