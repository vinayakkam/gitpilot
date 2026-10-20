import { useState } from "react";
import { GitMerge } from "lucide-react";
import type { RepoStatus } from "@/bindings/RepoStatus";
import type { SequenceAction } from "@/bindings/SequenceAction";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useIntegrate } from "@/lib/useIntegrate";
import { useStore } from "@/store/AppStore";

const NAMES = { merging: "merge", rebasing: "rebase", cherryPicking: "cherry-pick", reverting: "revert" } as const;

/** Explains a paused merge/rebase/cherry-pick/revert and offers Continue, Skip and Abort. */
export function OperationBanner({ status }: { status: RepoStatus }) {
  const { activeRepo, busy } = useStore();
  const integrate = useIntegrate();
  const [confirm, setConfirm] = useState<SequenceAction | null>(null);
  const conflicts = new Set(status.files.filter((f) => f.area === "conflicted").map((f) => f.path)).size;

  if (status.state === "normal") return null;
  if (status.state === "bisecting")
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning-bg px-3 py-2 text-base">
        A bisect session is active in this repository. Finish it from a terminal with git bisect reset.
      </div>
    );

  const op = NAMES[status.state];
  const id = activeRepo?.id;
  const run = (action: SequenceAction) => {
    if (id == null) return Promise.resolve(false);
    const label = action === "continue" ? `Continue ${op}` : action === "skip" ? `Skip commit` : `Abort ${op}`;
    const done = action === "abort" ? `Aborted the ${op}` : action === "skip" ? "Skipped that commit" : `Continued the ${op}`;
    return integrate(label, () => api.sequenceRun(id, action), done);
  };

  let text: string;
  if (conflicts > 0) {
    text = `The ${op} stopped with ${plural(conflicts, "conflicted file")}. Resolve each one in your editor, mark it resolved, then continue.`;
  } else if (status.state === "merging") {
    text = "All conflicts are resolved. Commit to finish the merge, or abort it.";
  } else {
    text = `All conflicts are resolved. Continue the ${op} to commit and move on.`;
  }

  const continueBlocked = conflicts > 0;
  const canSkip = status.state !== "merging";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-conflict-bg px-3 py-2 text-base">
      <GitMerge size={15} className="shrink-0 text-conflict" />
      <span className="min-w-0 flex-1">{text}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="danger-ghost" disabled={!!busy} onClick={() => setConfirm("abort")}>
          Abort {op}
        </Button>
        {canSkip && (
          <Button size="sm" disabled={!!busy} onClick={() => setConfirm("skip")}>
            Skip this commit
          </Button>
        )}
        {status.state !== "merging" && (
          <Tooltip content={continueBlocked ? "Resolve and mark every conflicted file first" : ""}>
            <span>
              <Button size="sm" variant="primary" disabled={!!busy || continueBlocked} loading={busy === `Continue ${op}`} onClick={() => void run("continue")}>
                Continue {op}
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        danger
        title={confirm === "abort" ? `Abort the ${op}?` : "Skip this commit?"}
        confirmLabel={confirm === "abort" ? `Abort ${op}` : "Skip commit"}
        onConfirm={async () => {
          if (confirm) await run(confirm);
        }}
      >
        {confirm === "abort" ? (
          <p>
            Your branch goes back to exactly where it was before the {op} started. Any conflict resolutions you've made for it are thrown
            away.
          </p>
        ) : (
          <p>The commit being applied is left out entirely and its changes are discarded. The {op} then moves on to the next commit.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
