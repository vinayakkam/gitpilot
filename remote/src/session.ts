// Sending a command to the computer and waiting for its answer.
//
// The relay is a post box: this posts a sealed envelope and then asks, every second or so,
// whether anything has come back. Nothing here looks inside a message it can't open, and an
// answer that fails any check is ignored rather than shown -- a wrong reply is indistinguishable
// from noise, and noise shouldn't become a screen full of errors.

import { open, seal, type Envelope } from "./crypto";
import { computerId, lastSeqIn, nextSeqOut, noteSeqIn, type Link } from "./link";

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

export type RemoteFile = { path: string; area: string; change: string; conflict: string | null };
export type RemoteCommit = { hash: string; shortHash: string; subject: string; author: string; time: number };
export type RemoteDetail = RemoteRepo & { files: RemoteFile[]; commits: RemoteCommit[] };

const ANSWER_TIMEOUT_MS = 45_000;
const POLL_EVERY_MS = 1_000;

export class Relay {
  constructor(
    private readonly base: string,
    private readonly link: Link,
    private readonly key: CryptoKey,
  ) {}

  private url(path: string): string {
    return `${this.base.replace(/\/$/, "")}/remote/${path}`;
  }

  /** Is the relay there at all? Used for the "can't reach" screen. */
  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(this.url("health"));
      return res.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async takeAnswers(): Promise<Envelope[]> {
    const res = await fetch(
      `${this.url("poll")}?id=${encodeURIComponent(this.link.channel)}&secret=${encodeURIComponent(this.link.secret)}&since=0`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { messages?: { n: number; body: string }[] };
    const out: Envelope[] = [];
    for (const message of body.messages ?? []) {
      try {
        out.push(JSON.parse(message.body) as Envelope);
      } catch {
        // Not ours, or damaged. The relay holds anything anyone posts, so this is expected.
      }
    }
    return out;
  }

  /**
   * Sends one command and waits for the computer's answer.
   *
   * Throws when the relay can't be reached, when GitPilot doesn't answer in time (it may simply
   * not be running), or when the channel has expired -- each with something the user can act on.
   */
  async run(command: Command, signal?: AbortSignal): Promise<Reply> {
    const envelope = await seal(this.key, this.link.device, nextSeqOut(), JSON.stringify(command));
    const sent = await this.post("send", {
      id: this.link.channel,
      secret: this.link.secret,
      body: JSON.stringify(envelope),
    }).catch(() => null);

    if (!sent) throw new Error("No connection. Check your phone's internet.");
    if (sent.status === 404) throw new Error("This phone isn't paired any more. Pair it again from the computer.");
    if (sent.status === 429) throw new Error("Too many requests just now. Wait a moment and try again.");
    if (!sent.ok) throw new Error("The relay refused that. Try again in a moment.");

    const until = Date.now() + ANSWER_TIMEOUT_MS;
    while (Date.now() < until) {
      if (signal?.aborted) throw new Error("Cancelled.");
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      for (const answer of await this.takeAnswers().catch(() => [])) {
        try {
          const plain = await open(this.key, answer, computerId(this.link), lastSeqIn());
          noteSeqIn(answer.seq);
          return JSON.parse(plain) as Reply;
        } catch {
          // Someone else's message, a replay, or a stale one: ignore it and keep waiting.
        }
      }
    }
    throw new Error("The computer didn't answer. Is GitPilot running and online?");
  }
}
