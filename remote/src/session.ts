// Talking to one paired computer through the relay.
//
// The relay is a post box: this posts a sealed envelope and then asks, about once a second,
// whether anything has come back. Two things make that reliable rather than fragile. The channel
// is derived from the pairing key, so when the relay has forgotten it — it keeps nothing on disk —
// this simply puts it back instead of claiming the phone is no longer paired. And an answer that
// fails any check is ignored rather than shown: a wrong reply is indistinguishable from noise,
// and noise shouldn't become a screen full of errors.

import { importKey, open, seal, type Envelope } from "./crypto";
import { computerId, derive, type Derived } from "./derive";
import { lastSeqIn, nextSeqOut, noteSeqIn, type Pairing } from "./link";

/** Matches `Command` in the desktop's `remote/dispatch.rs`. */
export type Command =
  | { cmd: "list" }
  | { cmd: "open"; repo: number }
  | { cmd: "diff"; repo: number; path: string; area: string }
  | { cmd: "stage"; repo: number; paths: string[] }
  | { cmd: "unstage"; repo: number; paths: string[] }
  | { cmd: "commit"; repo: number; message: string }
  | { cmd: "fetch"; repo: number }
  | { cmd: "pull"; repo: number }
  | { cmd: "push"; repo: number; confirmed: boolean };

/** Matches `Reply`. */
export type Reply = {
  ok: boolean;
  message: string;
  kind: string | null;
  detail: string | null;
  data: unknown;
};

export type RemoteRepo = {
  id: number;
  name: string;
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  changed: number;
  conflicts: number;
  state: string;
};

export type RemoteOverview = { computer: string; repos: RemoteRepo[] };
export type RemoteFile = { path: string; area: string; change: string; conflict: string | null };
export type RemoteCommit = { hash: string; shortHash: string; subject: string; author: string; time: number };
export type RemoteDetail = RemoteRepo & { files: RemoteFile[]; commits: RemoteCommit[] };

const ANSWER_TIMEOUT_MS = 45_000;
const POLL_EVERY_MS = 1_000;
/** The computer polls every 3 s in use and every 15 s idle, so this is comfortably "just now". */
export const ONLINE_WITHIN_SECONDS = 40;

export class Relay {
  private derived: Derived | null = null;

  constructor(
    private readonly base: string,
    private readonly pairing: Pairing,
  ) {}

  private async channel(): Promise<Derived> {
    this.derived ??= await derive(this.pairing.key);
    return this.derived;
  }

  private url(path: string): string {
    return `${this.base.replace(/\/$/, "")}/remote/${path}`;
  }

  private async key(): Promise<CryptoKey> {
    return importKey(this.pairing.key);
  }

  /** Puts this pairing's channel back on the relay. Harmless when it is already there. */
  private async claim(): Promise<boolean> {
    const { channel, secret, pcSecret } = await this.channel();
    const res = await fetch(this.url("register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channel, secret: pcSecret, peerSecret: secret }),
    }).catch(() => null);
    return !!res?.ok;
  }

  /**
   * How long ago the computer looked for commands, in seconds, or null if it hasn't lately.
   *
   * This is the green dot. It costs the relay one timestamp, far less than sending a command just
   * to find out whether anyone is listening.
   */
  async presence(): Promise<number | null> {
    const { channel, secret } = await this.channel();
    const res = await fetch(
      `${this.url("presence")}?id=${encodeURIComponent(channel)}&secret=${encodeURIComponent(secret)}`,
    ).catch(() => null);

    if (res?.status === 404) {
      // The relay forgot the channel. Put it back, and report "not seen" for now.
      await this.claim();
      return null;
    }
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as { peerSeen?: number | null } | null;
    return body?.peerSeen ?? null;
  }

  private async takeAnswers(): Promise<Envelope[]> {
    const { channel, secret } = await this.channel();
    const res = await fetch(
      `${this.url("poll")}?id=${encodeURIComponent(channel)}&secret=${encodeURIComponent(secret)}&since=0`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { messages?: { n: number; body: string }[] };
    const out: Envelope[] = [];
    for (const message of body.messages ?? []) {
      try {
        out.push(JSON.parse(message.body) as Envelope);
      } catch {
        // Not ours, or damaged. The relay holds whatever anyone posts, so this is expected.
      }
    }
    return out;
  }

  /**
   * Sends one command and waits for the computer's answer.
   *
   * Throws when the relay can't be reached, or when GitPilot doesn't answer in time — which
   * usually means it simply isn't running.
   */
  async run(command: Command): Promise<Reply> {
    const { channel, secret } = await this.channel();
    const key = await this.key();
    const envelope = await seal(key, this.pairing.device, nextSeqOut(this.pairing.device), JSON.stringify(command));

    const post = () =>
      fetch(this.url("send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channel, secret, body: JSON.stringify(envelope) }),
      }).catch(() => null);

    let sent = await post();
    if (sent?.status === 404) {
      // The relay restarted, or the channel went idle while the computer was off. Rebuild it.
      if (await this.claim()) sent = await post();
    }

    if (!sent) throw new Error("No connection. Check your phone's internet.");
    if (sent.status === 429) throw new Error("Too many requests just now. Wait a moment and try again.");
    if (!sent.ok) throw new Error("The relay refused that. Try again in a moment.");

    const until = Date.now() + ANSWER_TIMEOUT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      for (const answer of await this.takeAnswers().catch(() => [])) {
        try {
          const plain = await open(key, answer, computerId(this.pairing.device), lastSeqIn(this.pairing.device));
          noteSeqIn(this.pairing.device, answer.seq);
          return JSON.parse(plain) as Reply;
        } catch {
          // Someone else's message, a replay, or a stale one: ignore it and keep waiting.
        }
      }
    }
    throw new Error("GitPilot didn't answer. Is it running on that computer?");
  }
}
