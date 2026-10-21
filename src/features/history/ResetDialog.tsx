import { useEffect, useState } from "react";
import type { ResetMode } from "@/bindings/ResetMode";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useStore } from "@/store/AppStore";

const MODES: { value: ResetMode; title: string; body: string }[] = [
  { value: "soft", title: "Keep changes staged", body: "The branch moves back; everything from the removed commits stays staged, ready to commit again." },
  { value: "mixed", title: "Keep changes in your files", body: "The branch moves back; the changes stay in your files but are unstaged." },
  { value: "hard", title: "Discard everything after it", body: "The branch and your files go back to exactly this commit. Uncommitted work is saved in the backup too." },
];

/** Moves the current branch to a commit. A backup is always saved first (Branches → Backups). */
export function ResetDialog({ target, onClose }: { target: { hash: string; label: string } | null; onClose: () => void }) {
  const { activeRepo, status, run, notify } = useStore();
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target) {
      setMode("mixed");
      setAck(false);
    }
  }, [target]);
  const branch = status?.branch.head ?? "the current branch";

  const go = async () => {
    if (!activeRepo || !target || (mode === "hard" && !ack)) return;
    setBusy(true);
    const b = await run("Reset", () => api.branchReset(activeRepo.id, target.hash, mode));
    setBusy(false);
    if (b) {
      notify({ tone: "success", title: `Reset ${branch} to ${target.hash.slice(0, 7)}`, body: "A backup of the previous state is under Branches → Backups." });
      onClose();
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      busy={busy}
      width={520}
      title={`Reset ${branch} to this commit?`}
      description={target?.label}
      onSubmit={go}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={mode === "hard" ? "danger" : "primary"} loading={busy} disabled={mode === "hard" && !ack}>
            Reset branch
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="What happens to the changes" className="flex flex-col gap-1.5">
          {MODES.map((m) => (
            <label key={m.value} className={cx("flex cursor-pointer gap-2.5 rounded border px-3 py-2", mode === m.value ? (m.value === "hard" ? "border-danger bg-removed-bg" : "border-accent bg-accent-soft") : "border-border hover:bg-surface-2")}>
              <input type="radio" name="reset-mode" className="mt-1" checked={mode === m.value} onChange={() => setMode(m.value)} data-autofocus={m.value === "mixed" ? true : undefined} />
              <span>
                <span className="block text-base font-medium">{m.title}</span>
                <span className="block text-sm text-muted">{m.body}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === "hard" && <Checkbox checked={ack} onChange={setAck} label="I understand my files will be changed to match this commit." />}
        <p className="text-xs text-faint">Commits that were already pushed stay on the remote; you'd need to push with force (with lease) to replace them.</p>
      </div>
    </Dialog>
  );
}
