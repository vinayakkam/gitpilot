import { useState } from "react";
import type { AppError } from "@/bindings/AppError";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice } from "@/components/ui/Misc";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";

type Target = { kind: "local"; name: string } | { kind: "remote"; remoteBranch: string; localName: string };

/**
 * Switching branches safely: with a clean tree we switch directly. With uncommitted changes the
 * user chooses between carrying them over (Git refuses if they'd be overwritten) or stashing first.
 * Nothing is ever discarded or stashed without an explicit choice.
 */
export function useBranchSwitch() {
  const { activeRepo, status, run } = useStore();
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState<"carry" | "stash" | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const changed = status?.files.length ?? 0;
  const label = (t: Target) => (t.kind === "local" ? t.name : t.localName);

  const perform = async (t: Target) => {
    if (!activeRepo) return;
    if (t.kind === "local") await api.branchSwitch(activeRepo.id, t.name);
    else await api.branchCheckoutRemote(activeRepo.id, t.remoteBranch, t.localName);
  };

  const request = (t: Target) => {
    if (!activeRepo) return;
    setError(null);
    if (changed === 0) {
      void run(`Switch to ${label(t)}`, () => perform(t), { success: `Switched to ${label(t)}` });
    } else {
      setTarget(t);
    }
  };

  const go = async (mode: "carry" | "stash") => {
    if (!target || !activeRepo) return;
    setBusy(mode);
    setError(null);
    try {
      await run(
        `Switch to ${label(target)}`,
        async () => {
          if (mode === "stash") {
            await api.stashPush(activeRepo.id, `GitPilot: before switching to ${label(target)}`, true);
          }
          await perform(target);
        },
        { rethrow: true, quiet: true, success: mode === "stash" ? `Stashed changes and switched to ${label(target)}` : `Switched to ${label(target)}` },
      );
      setTarget(null);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(null);
    }
  };

  const dialog = (
    <Dialog
      open={target !== null}
      onClose={() => setTarget(null)}
      busy={busy !== null}
      width={480}
      title={`Switch to ${target ? label(target) : ""}?`}
      description={`You have ${plural(changed, "uncommitted change")}. Choose what happens to them.`}
      footer={
        <>
          <Button onClick={() => setTarget(null)} disabled={busy !== null}>
            Cancel
          </Button>
          <Button onClick={() => go("stash")} loading={busy === "stash"} disabled={busy !== null}>
            Stash, then switch
          </Button>
          <Button variant="primary" onClick={() => go("carry")} loading={busy === "carry"} disabled={busy !== null}>
            Bring changes along
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2 text-base text-muted">
        <li>
          <span className="font-medium text-text">Bring changes along</span> keeps your edits in the working tree on the
          new branch. Git stops without changing anything if they'd conflict.
        </li>
        <li>
          <span className="font-medium text-text">Stash, then switch</span> saves your edits (including new files) to the
          stash. Restore them later from Branches → Stashes.
        </li>
      </ul>
      {error && (
        <ErrorNotice
          className="mt-3"
          error={
            error.kind === "localChangesWouldBeOverwritten"
              ? { ...error, message: "Your changes conflict with that branch, so Git didn't switch. Stash them first, or commit them." }
              : error
          }
        />
      )}
    </Dialog>
  );

  return { request, dialog };
}
