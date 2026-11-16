// Working out a pairing's channel from its key.
//
// The relay keeps channels in memory and drops them when nobody polls for an hour, so a channel
// is usually gone after the computer has been off. Rather than making you scan a new code, both
// ends derive the same channel id, secrets and device id from the pairing key they already share,
// and either can put the channel back exactly as it was.
//
// This must agree with `PairingKey::derive` in the desktop's `remote/crypto.rs` to the byte.
// `derive.test.ts` pins it against values the Rust tests produce.

import { fromB64Url, toB64Url } from "./crypto";

const PURPOSE_CHANNEL = "gitpilot/relay/channel";
const PURPOSE_PC = "gitpilot/relay/secret/pc";
const PURPOSE_PHONE = "gitpilot/relay/secret/phone";
const PURPOSE_DEVICE = "gitpilot/device";

async function hmac(keyB64: string, purpose: string, bytes: number): Promise<string> {
  const raw = fromB64Url(keyB64);
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(raw).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new Uint8Array(new TextEncoder().encode(purpose)).buffer);
  return toB64Url(new Uint8Array(mac).slice(0, bytes));
}

/** Everything about a pairing that isn't the key itself. */
export type Derived = {
  /** The relay channel this pairing uses. */
  channel: string;
  /** This phone's secret for it. The computer has a different one. */
  secret: string;
  /** The computer's secret, needed to put the channel back. */
  pcSecret: string;
  /** This phone's device id, as it appears in every envelope it sends. */
  device: string;
};

export async function derive(keyB64: string): Promise<Derived> {
  const [channel, pcSecret, secret, device] = await Promise.all([
    hmac(keyB64, PURPOSE_CHANNEL, 16),
    hmac(keyB64, PURPOSE_PC, 18),
    hmac(keyB64, PURPOSE_PHONE, 18),
    hmac(keyB64, PURPOSE_DEVICE, 9),
  ]);
  return { channel, secret, pcSecret, device: `d${device}` };
}

/** The id the computer seals its answers under. */
export function computerId(device: string): string {
  return `${device}~pc`;
}
