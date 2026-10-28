import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";

const MAX_BACKOFF_MINUTES = 120;

/** Minutes until the next background fetch: the setting, doubled for each failure in a row. */
export function nextDelayMinutes(every: number, failures: number): number {
  return Math.min(MAX_BACKOFF_MINUTES, every * 2 ** Math.min(failures, 8));
}

/**
 * Fetches the open repository in the background every `settings.autoFetchMinutes` minutes, and
 * offers Pull when the current branch fell further behind. Skipped while an operation runs or
 * when offline; never asks for credentials (the backend fetch is non-interactive).
 */
export function useAutoFetch(pull: () => void) {
  const { activeRepo, settings, status, busy, notify, refreshStatus } = useStore();
  const id = activeRepo?.id;
  const every = settings?.autoFetchMinutes ?? 0;
  const hasRemote = !!status?.branch.upstream;
  // Read the latest values inside the timer without restarting it.
  const live = useRef({ status, busy, pull });
  live.current = { status, busy, pull };

  useEffect(() => {
    if (id == null || every <= 0 || !hasRemote) return;
    let failures = 0;
    let timer: number | undefined;
    let stopped = false;
    const schedule = () => {
      timer = window.setTimeout(() => void tick(), nextDelayMinutes(every, failures) * 60_000);
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
      schedule();
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id, every, hasRemote, notify, refreshStatus]);
}
