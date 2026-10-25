import { useState } from "react";
import { ExternalLink, HardDrive, Plus, TriangleAlert, X } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { LfsPattern } from "@/bindings/LfsPattern";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

export const LFS_URL = "https://git-lfs.com";

/** A pattern for `git lfs track`, or why it can't be used (mirrors the backend check). */
export function lfsPatternProblem(p: string): string | null {
  const t = p.trim();
  if (!t) return "Enter a pattern, like *.psd.";
  if (/^[-#!]/.test(t) || [...t].some((c) => c.charCodeAt(0) < 32)) return "A pattern can't start with -, # or ! and must be on one line.";
  return null;
}

/** Git LFS for the open repository: which file types it stores, and setup problems. */
export function LfsCard() {
  const { activeRepo, revision, run } = useStore();
  const id = activeRepo?.id;
  const lfs = useAsync(() => api.lfsStatus(id!, true), [id, revision], id != null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LfsPattern | null>(null);
  if (id == null) return null;
  const s = lfs.data;
  if (lfs.loading && !s) return <Spinner label="Checking Git LFS" />;
  if (lfs.error) return <ErrorNotice compact error={lfs.error} />;
  if (!s) return null;

  const used = s.patterns.length > 0;
  const pointers = s.files.filter((f) => !f.downloaded).length;

  return (
    <div className="flex flex-col gap-2">
      {!s.installed ? (
        used ? (
          <p className="flex items-start gap-2 text-warning">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              This repository stores large files with Git LFS, which isn't installed. Those files show up as small pointer files until you install it.{" "}
              <button type="button" className="inline-flex items-center gap-1 text-accent-text hover:underline" onClick={() => void openLink(LFS_URL)}>
                Get Git LFS <ExternalLink size={11} />
              </button>
            </span>
          </p>
        ) : (
          <span className="text-muted">Not used. Git LFS isn't installed, which is fine unless a repository needs it.</span>
        )
      ) : used ? (
        <span>
          {plural(s.fileCount, "file")} stored with LFS
          {pointers > 0 && <span className="text-warning"> ({pointers} not downloaded)</span>}
          <span className="block text-sm text-faint">{s.version}</span>
        </span>
      ) : (
        <span className="text-muted">Not used in this repository.</span>
      )}
      {used && (
        <ul className="flex flex-wrap gap-1.5" aria-label="File types stored with LFS">
          {s.patterns.map((p) => (
            <li key={`${p.file}:${p.pattern}`} className="inline-flex h-6 items-center gap-1 rounded-sm bg-surface-3 pl-2 font-mono text-xs" title={`From ${p.file}`}>
              {p.pattern}
              {s.installed && p.file === ".gitattributes" ? (
                <IconButton size="sm" label={`Stop storing ${p.pattern} with LFS…`} icon={<X size={11} />} onClick={() => setRemoving(p)} />
              ) : (
                <span className="w-1.5" />
              )}
            </li>
          ))}
        </ul>
      )}
      {s.installed && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
            Store a file type with LFS…
          </Button>
          {used && !s.hooksInstalled && (
            <Button size="sm" icon={<HardDrive size={12} />} onClick={() => void run("Set up Git LFS", () => api.lfsInstallHooks(id), { success: "Git LFS is set up for this repository" })}>
              Set up LFS for this repository
            </Button>
          )}
        </div>
      )}
      {s.installed && used && !s.hooksInstalled && <p className="text-sm text-muted">Without LFS's hooks, pushing can leave large files behind on this computer.</p>}
      <TrackDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Stop storing ${removing?.pattern ?? ""} with LFS?`}
        confirmLabel="Stop storing with LFS"
        onConfirm={async () => {
          if (removing) await run("Stop storing with LFS", () => api.lfsUntrack(id, removing.pattern), { rethrow: true, success: `${removing.pattern} is no longer stored with LFS` });
        }}
      >
        <p>New files of this type will be stored in Git directly. Files already committed with LFS stay in LFS. This changes .gitattributes; commit it to share the change.</p>
      </ConfirmDialog>
    </div>
  );
}

function TrackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeRepo, run } = useStore();
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const problem = pattern ? lfsPatternProblem(pattern) : null;
  const submit = async () => {
    if (!activeRepo || lfsPatternProblem(pattern)) return;
    setBusy(true);
    setError(null);
    try {
      await run("Store with LFS", () => api.lfsTrack(activeRepo.id, pattern.trim()), { rethrow: true, quiet: true, success: `${pattern.trim()} will be stored with LFS` });
      setPattern("");
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
      title="Store a file type with Git LFS"
      description="Large binary files (designs, videos, datasets) are kept out of the Git history and downloaded when needed."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!pattern.trim() || !!problem}>
            Store with LFS
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Files to store with LFS" error={problem} hint="For example *.psd, *.mp4 or assets/videos/**. This adds a line to .gitattributes; commit it so others use LFS for these files too.">
          {(p) => <Input {...p} autoFocus value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="*.psd" className="font-mono text-sm" />}
        </Field>
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
