import { useCallback } from "react";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

/**
 * Runs merge / rebase / cherry-pick / revert / continue. When Git stops for conflicts that is an
 * expected pause, not a failure: we say so and take the user to Changes to resolve them.
 */
export function useIntegrate() {
  const { run, notify, setSection } = useStore();
  return useCallback(
    async (label: string, fn: () => Promise<void>, success: string) => {
      try {
        await run(label, fn, { rethrow: true, quiet: true, success });
        return true;
      } catch (e) {
        const err = toAppError(e);
        if (err.kind === "conflict") {
          notify({ tone: "info", title: `${label} paused for conflicts`, body: "Resolve the conflicted files in Changes, mark them resolved, then choose Continue." });
          setSection("changes");
        } else if (err.kind !== "cancelled") {
          notify({ tone: "error", title: `${label} failed`, error: err });
        }
        return false;
      }
    },
    [run, notify, setSection],
  );
}
