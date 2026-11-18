// The phone half of the sealed envelope. Must match `src-tauri/src/remote/crypto.rs` exactly.
//
// AES-256-GCM was chosen for this side's sake: WebCrypto has it built in, so the phone app ships
// no crypto library at all. The key arrives in the QR fragment and lives in this browser's
// storage; it never goes to the relay or to the site that serves this page.

export const PROTOCOL_VERSION = 1;
const NONCE_BYTES = 12;
/** Both sides refuse anything further from their own clock than this. */
export const MAX_CLOCK_SKEW_SECS = 300;

export type Envelope = {
  v: number;
  id: string;
  seq: number;
  ts: number;
  nonce: string;
  ct: string;
};

export function toB64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * A plain ArrayBuffer copy. WebCrypto's types insist on one: a Uint8Array can be backed by a
 * SharedArrayBuffer, which these calls don't accept.
 */
function buf(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

export async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64Url(keyB64);
  if (raw.length !== 32) throw new Error("That pairing code isn't complete. Scan it again.");
  return crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** What the tag covers besides the message itself, so none of it can be swapped in flight. */
function associatedData(v: number, id: string, seq: number, ts: number): Uint8Array {
  return new TextEncoder().encode(`${v}:${id}:${seq}:${ts}`);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function seal(key: CryptoKey, device: string, seq: number, plaintext: string): Promise<Envelope> {
  const ts = nowSeconds();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: buf(nonce),
      additionalData: buf(associatedData(PROTOCOL_VERSION, device, seq, ts)),
    },
    key,
    buf(new TextEncoder().encode(plaintext)),
  );
  return {
    v: PROTOCOL_VERSION,
    id: device,
    seq,
    ts,
    nonce: toB64Url(nonce),
    ct: toB64Url(new Uint8Array(ct)),
  };
}

export class OpenFailed extends Error {}

/**
 * The messages seen lately, so none can be used twice.
 *
 * This replaces counting. A counter has to be kept by both ends for the life of the pairing, and
 * if either loses it — site data cleared here, settings restored from a backup there — every later
 * message looks like a replay and the two can never talk again, with nothing to do but pair afresh.
 *
 * A nonce is 96 random bits, new for every message, so remembering the ones seen inside the
 * five-minute window catches a replay just as well. An empty memory is a correct memory: anything
 * older than the window is refused on its timestamp.
 */
const seen = new Map<string, number>();

function alreadySeen(nonce: string, now: number): boolean {
    for (const [value, when] of seen) {
      if (Math.abs(now - when) > MAX_CLOCK_SKEW_SECS) seen.delete(value);
    }
    if (seen.has(nonce)) return true;
    seen.set(nonce, now);
    return false;
}

/**
 * Checks and opens one envelope from the computer. The checks are the same ones the desktop
 * makes, in the same order: right version, right sender, not a replay, not stale, then the tag.
 */
export async function open(
  key: CryptoKey,
  env: Envelope,
  expectFrom: string,
  now = nowSeconds(),
): Promise<string> {
  if (env.v !== PROTOCOL_VERSION) throw new OpenFailed("That answer came from a different version of GitPilot.");
  if (env.id !== expectFrom) throw new OpenFailed("That answer didn't come from the paired computer.");
  if (Math.abs(env.ts - now) > MAX_CLOCK_SKEW_SECS) {
    throw new OpenFailed("Your phone's clock is too far from the computer's. Check the date and time.");
  }
  if (alreadySeen(env.nonce, now)) throw new OpenFailed("That answer was already handled.");
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buf(fromB64Url(env.nonce)),
        additionalData: buf(associatedData(env.v, env.id, env.seq, env.ts)),
      },
      key,
      buf(fromB64Url(env.ct)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new OpenFailed("That answer couldn't be unlocked with this phone's key.");
  }
}
