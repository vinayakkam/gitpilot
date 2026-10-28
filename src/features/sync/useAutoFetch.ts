import { useEffect, useRef } from "react";
import type { GitHubLink } from "@/bindings/GitHubLink";
import type { PullRequest } from "@/bindings/PullRequest";
import { defaultTarget, pullForBranch } from "@/features/github/pulls";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";

const MAX_BACKOFF_SECONDS = 2 * 60 * 60;

/** Seconds until the next background fetch: the setting, doubled for each failure in a row (at most 2 hours). */
export function nextDelaySeconds(every: number, failures: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, every * 2 ** Math.min(failures, 12));
}

/** GitHub is asked about the branch's pull request at most this often, whatever the fetch interval. */
const PULL_CHECK_MS = 60_000;

type PullState = Pick<PullRequest, "checks" | "review">;

/** What to tell the user when the branch's pull request changed since last time (nothing the first time). */
export function pullNotice(before: PullState | undefined, now: PullRequest): string | null {
  if (!before) return null;
  if (now.checks !== before.checks) {
    if (now.checks === "failing") return `Checks failed on #${now.number}`;
    if (now.checks === "passing") return `Checks passed on #${now.number}`;
  }
  if (now.review !== before.review) {
    if (now.review === "approved") return `#${now.number} was approved`;
    if (now.review === "changesRequested") return `Changes were requested on #${now.number}`;
  }
  return null;
}

/**
 * Fetches the open repository in the background every `settings.autoFetchSeconds` seconds, and
 * offers Pull when the current branch fell further behind. Skipped while an operation runs or
 * when offline; never asks for credentials (the backend fetch is non-interactive).
 */
export function useAutoFetch(pull: () => void) {
  const { activeRepo, settings, status, busy, notify, refreshStatus, setSection } = useStore();
  const id = activeRepo?.id;
  const every = settings?.autoFetchSeconds ?? 0;
  const hasRemote = !!status?.branch.upstream;
  // Read the latest values inside the timer without restarting it.
  const live = useRef({ status, busy, pull });
  live.current = { status, busy, pull };

  useEffect(() => {
    if (id == null || every <= 0 || !hasRemote) return;
    let failures = 0;
    let timer: number | undefined;
    let stopped = false;
    // The repository's GitHub link: undefined = not looked up yet, null = not on GitHub or not signed in.
    let link: GitHubLink | null | undefined;
    let lastPullCheck = 0;
    const seen = new Map<number, PullState>();
    const watchPull = async () => {
      if (Date.now() - lastPullCheck < PULL_CHECK_MS) return;
      lastPullCheck = Date.now();
      if (link === undefined) link = await api.githubLink(id).catch(() => null);
      if (!link) return;
      const target = defaultTarget(link);
      const pulls = await api.githubPulls(target.owner, target.name).catch(() => null);
      const pr = pulls && pullForBranch(pulls, live.current.status?.branch, link);
      if (!pr || stopped) return;
      const msg = pullNotice(seen.get(pr.number), pr);
      seen.set(pr.number, { checks: pr.checks, review: pr.review });
      if (msg) notify({ tone: pr.checks === "failing" || pr.review === "changesRequested" ? "error" : "info", title: msg, body: pr.title, action: { label: "Open", run: () => setSection("pulls") } });
    };
    const schedule = () => {
      timer = window.setTimeout(() => void tick(), nextDelaySeconds(every, failures) * 1000);
    };
    const tick = async () => {
      if (stopped) return;
      if (live.current.busy || !navigator.onLine) return schedule();
      const before = live.current.status?.branch.behind ?? 0;
      try {
        await api.fetch(id, null, true);
        failures = 0;
      } catch {
        // Locked (another operation started), offline or credentials needed: try again later.
        failures++;
        return schedule();
      }
      if (stopped) return;
      await refreshStatus();
      const st = await api.status(id).catch(() => null);
      const behind = st?.branch.behind ?? 0;
      if (!stopped && st && behind > before) {
        notify({
          tone: "info",
          title: `${plural(behind - before, "new commit")} on ${st.branch.upstream}`,
          body: "Fetched in the background.",
          action: { label: "Pull", run: () => live.current.pull() },
        });
      }
      await watchPull();
      schedule();
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id, every, hasRemote, notify, refreshStatus, setSection]);
}
