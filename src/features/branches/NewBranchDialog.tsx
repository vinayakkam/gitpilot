import { useEffect, useState } from "react";
import type { AppError } from "@/bindings/AppError";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

/** Mirrors the backend's rules for quick feedback; the backend still validates with git check-ref-format. */
export function branchNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (/\s/.test(n)) return "Branch names can't contain spaces. Try dashes: my-feature.";
  if (n.startsWith("-")) return "Branch names can't start with a dash.";
  if (/[~^:?*[\\]/.test(n) || n.includes("..") || n.includes("@{")) return "Branch names can't contain ~ ^ : ? * [ \\ or “..”.";
  if (n.endsWith("/") || n.endsWith(".") || n.endsWith(".lock")) return "Branch names can't end with “/”, “.” or “.lock”.";
  return null;
}

export function NewBranchDialog({ open, onClose, startPoint }: { open: boolean; onClose: () => void; startPoint?: string }) {
  const { activeRepo, status, run } = useStore();
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setCheckout(true);
    }
  }, [open]);

  const problem = branchNameProblem(name);
  const from = startPoint ?? status?.branch.head ?? "HEAD";
  const unborn = status?.branch.unborn;

  const submit = async () => {
    if (!activeRepo || !name.trim() || problem) return;
    setBusy(true);
    setError(null);
    try {
      await run("Create branch", () => api.branchCreate(activeRepo.id, name.trim(), startPoint ?? null, checkout), {
        rethrow: true,
        quiet: true,
        success: checkout ? `Created and switched to ${name.trim()}` : `Created ${name.trim()}`,
      });
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="New branch"
      description={
        unborn ? "This repository has no commits yet. Make a first commit before creating branches." : (
          <>
            Starts from <code className="font-mono text-text">{from}</code>. Uncommitted changes stay in your working tree.
          </>
        )
      }
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !!problem || unborn}>
            Create branch
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Branch name" error={problem}>
          {(p) => (
            <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/short-description" className="font-mono text-sm" />
          )}
        </Field>
        <Checkbox checked={checkout} onChange={setCheckout} label="Switch to the new branch" />
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
