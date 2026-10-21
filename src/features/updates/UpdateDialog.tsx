import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { openLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice } from "@/components/ui/Misc";
import { ReleaseNotes } from "@/components/ui/ReleaseNotes";
import { useStore } from "@/store/AppStore";
import { useUpdates } from "./UpdateProvider";

const RELEASES = "https://github.com/vinayakkam/gitpilot/releases/latest";

function mb(n: number) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateDialog() {
  const { info } = useStore();
  const { phase, support, dialogOpen, setDialogOpen, install, restart } = useUpdates();
  const update = "update" in phase ? phase.update : undefined;
  const working = phase.kind === "downloading" || phase.kind === "installing";
  const canInstall = support?.canInstall ?? false;
  const restartRef = useRef<HTMLButtonElement>(null);
  // The dialog stays open while it changes state, so move focus to the new primary action.
  useEffect(() => {
    if (phase.kind === "restartPending") restartRef.current?.focus();
  }, [phase.kind]);

  return (
    <Dialog
      open={dialogOpen && !!update}
      onClose={() => setDialogOpen(false)}
      busy={working}
      width={520}
      title={phase.kind === "restartPending" ? "Update installed" : `GitPilot ${update?.version ?? ""} is available`}
      description={
        phase.kind === "restartPending"
          ? "Restart GitPilot to start using the new version."
          : `You have ${info?.version ?? "an older version"}. Updating replaces the app in place; your repositories, settings and keys are kept.`
      }
      footer={
        phase.kind === "restartPending" ? (
          <>
            <Button onClick={() => setDialogOpen(false)}>Later</Button>
            <Button ref={restartRef} variant="primary" autoFocus onClick={() => void restart()}>
              Restart now
            </Button>
          </>
        ) : canInstall ? (
          <>
            <Button onClick={() => setDialogOpen(false)} disabled={working}>
              Not now
            </Button>
            <Button variant="primary" autoFocus loading={working} onClick={() => void install()}>
              {phase.kind === "downloading" ? "Downloading…" : phase.kind === "installing" ? "Installing…" : "Update now"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setDialogOpen(false)}>Close</Button>
            <Button variant="primary" icon={<ExternalLink size={13} />} onClick={() => void openLink(RELEASES)}>
              Open release page
            </Button>
          </>
        )
      }
    >
      {update?.body && phase.kind !== "restartPending" && (
        <ReleaseNotes source={update.body} className="selectable max-h-72 overflow-y-auto rounded border border-border bg-surface-2 px-3.5 py-3 text-sm leading-relaxed" />
      )}
      {phase.kind === "downloading" && (
        <div className="mt-3" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: phase.total ? `${Math.min(100, (phase.done / phase.total) * 100)}%` : "35%" }}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {mb(phase.done)}
            {phase.total ? ` of ${mb(phase.total)}` : ""}
          </p>
        </div>
      )}
      {phase.kind === "installing" && <p className="mt-3 text-sm text-muted">Installing… On Windows, GitPilot closes and the installer finishes the update.</p>}
      {support?.note && phase.kind !== "restartPending" && <p className="mt-3 text-sm text-muted">{support.note}</p>}
      {phase.kind === "error" && <ErrorNotice className="mt-3" error={phase.error} />}
    </Dialog>
  );
}
