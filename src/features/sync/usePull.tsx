import { useCallback, useState } from "react";
import type { PullOptions } from "@/bindings/PullOptions";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

type Choice = { kind: "diverged" | "unrelated"; target: string } | null;

/**
 * Pull with the follow-ups Git leaves to the user: when the branches have diverged, ask whether to
 * merge or rebase; when they share no history, explain and offer to combine them. Conflicts are a
 * pause handled in Changes, not a failure.
 */
export function usePull() {
  const { activeRepo, status, run, notify, setSection } = useStore();
  const [choice, setChoice] = useState<Choice>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const target = status?.branch.upstream ?? status?.remoteTwin?.name ?? "the remote branch";

  const attempt = useCallback(
    async (options: PullOptions | null): Promise<boolean> => {
      if (!activeRepo) return false;
      const linking = !status?.branch.upstream && !!status?.remoteTwin;
      try {
        await run("Pull", () => api.pull(activeRepo.id, options), {
          rethrow: true,
          quiet: true,
          success: linking ? `Pulled from ${target} and linked ${status?.branch.head} to it` : "Pulled latest changes",
        });
        return true;
      } catch (e) {
        const err = toAppError(e);
        if (err.kind === "diverged") setChoice({ kind: "diverged", target });
        else if (err.kind === "unrelatedHistories") {
          setAck(false);
          setChoice({ kind: "unrelated", target });
        } else if (err.kind === "conflict") {
          notify({ tone: "info", title: "Pull paused for conflicts", body: "Resolve the conflicted files in Changes, mark them resolved, then commit to finish the merge." });
          setSection("changes");
        } else if (err.kind !== "cancelled") notify({ tone: "error", title: "Pull failed", error: err });
        return false;
      }
    },
    [activeRepo, status, target, run, notify, setSection],
  );

  const pull = useCallback(() => attempt(null), [attempt]);

  const resolve = async (options: PullOptions) => {
    setBusy(true);
    setChoice(null);
    await attempt(options);
    setBusy(false);
  };

  const dialog = (
    <Dialog
      open={choice !== null}
      onClose={() => setChoice(null)}
      busy={busy}
      width={520}
      title={choice?.kind === "unrelated" ? "These branches don't share any history" : "Your branch and the remote have both changed"}
      description={
        choice?.kind === "unrelated" ? (
          <>
            Your <span className="font-mono">{status?.branch.head}</span> and <span className="font-mono">{choice?.target}</span> were started
            separately (for example, one from a downloaded copy of the files and the other by uploading on the website), so Git won't combine
            them on its own.
          </>
        ) : (
          <>
            You have commits that <span className="font-mono">{choice?.target}</span> doesn't, and it has commits you don't. Choose how to bring
            them together.
          </>
        )
      }
      footer={
        choice?.kind === "unrelated" ? (
          <>
            <Button onClick={() => setChoice(null)}>Cancel</Button>
            <Button variant="primary" disabled={!ack} onClick={() => void resolve({ strategy: "merge", allowUnrelated: true })}>
              Combine histories
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setChoice(null)}>Cancel</Button>
            <Button onClick={() => void resolve({ strategy: "rebase", allowUnrelated: false })}>Rebase</Button>
            <Button variant="primary" autoFocus onClick={() => void resolve({ strategy: "merge", allowUnrelated: false })}>
              Merge
            </Button>
          </>
        )
      }
    >
      {choice?.kind === "unrelated" ? (
        <div className="flex flex-col gap-2 text-base text-muted">
          <p>
            <span className="font-medium text-text">Combine histories</span> merges both into one branch and keeps all commits. Files that exist
            on both sides with different contents become conflicts you resolve in Changes.
          </p>
          <p>
            If one side is just an older copy you don't need, it can be simpler to keep only one of them. Ask for help before deleting
            anything.
          </p>
          <Checkbox className="mt-1 text-text" checked={ack} onChange={setAck} label="I want to combine both histories" />
        </div>
      ) : (
        <ul className="flex flex-col gap-2 text-base text-muted">
          <li>
            <span className="font-medium text-text">Merge</span> keeps both sets of commits as they are and adds a merge commit. Safe and the
            usual choice.
          </li>
          <li>
            <span className="font-medium text-text">Rebase</span> replays your commits on top of the remote ones for a straight history. Your
            local commits get new ids.
          </li>
          <li>To always use one of these, set the pull strategy in Settings → Git.</li>
        </ul>
      )}
    </Dialog>
  );

  return { pull, dialog };
}
