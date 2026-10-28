import { useState } from "react";
import { GitBranchPlus, LifeBuoy, Trash2 } from "lucide-react";
import type { Backup } from "@/bindings/Backup";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { absoluteTime, relativeTime } from "@/lib/format";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { NewBranchDialog } from "./NewBranchDialog";

/** Backups GitPilot saved before resets and commit edits. Hidden when there are none. */
export function BackupsSection() {
  const { activeRepo, revision, run, busy, status } = useStore();
  const id = activeRepo?.id;
  const backups = useAsync(() => api.backupList(id!), [id, revision], id != null);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [del, setDel] = useState<Backup | null>(null);
  const [branchAt, setBranchAt] = useState<string | null>(null);
  if (id == null || !backups.data?.length) return null;

  return (
    <section aria-label="Backups">
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 px-4 text-sm font-semibold text-muted">
        Backups <span className="font-normal text-faint">{backups.data.length}</span>
      </h3>
      {backups.data.map((b) => (
        <div key={b.name} className="flex h-9 items-center gap-3 border-b border-border px-4">
          <LifeBuoy size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {b.label || "Backup"}
            {b.wip && <span className="ml-2 text-xs text-faint">+ uncommitted changes</span>}
          </span>
          <span className="font-mono text-xs text-faint">{b.hash.slice(0, 7)}</span>
          <span className="text-xs text-faint" title={absoluteTime(b.time)}>{relativeTime(b.time)}</span>
          <Button size="sm" disabled={!!busy || status?.state !== "normal"} onClick={() => setRestore(b)}>
            Restore
          </Button>
          <IconButton size="sm" label="Create branch from this backup…" icon={<GitBranchPlus size={13} />} onClick={() => setBranchAt(b.hash)} />
          <IconButton size="sm" tone="danger" label="Delete backup…" icon={<Trash2 size={13} />} onClick={() => setDel(b)} />
        </div>
      ))}

      <NewBranchDialog open={branchAt !== null} onClose={() => setBranchAt(null)} startPoint={branchAt ?? undefined} />
      <ConfirmDialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        danger
        acknowledge="I understand my current files will be replaced."
        title="Restore this backup?"
        confirmLabel="Restore"
        onConfirm={async () => {
          if (!restore) return;
          await run("Restore backup", () => api.backupRestore(id, restore.name), { success: "Backup restored", rethrow: true });
        }}
      >
        <p>
          {status?.branch.head ?? "The current branch"} goes back to <span className="font-mono">{restore?.hash.slice(0, 7)}</span>
          {restore?.wip ? " and the uncommitted changes saved with it are put back" : ""}. Your current state is backed up first, so this can be undone too.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={del !== null}
        onClose={() => setDel(null)}
        danger
        title="Delete this backup?"
        confirmLabel="Delete backup"
        onConfirm={async () => {
          if (!del) return;
          await run("Delete backup", () => api.backupDelete(id, del.name), { rethrow: true });
        }}
      >
        <p>Commits only kept by this backup may be cleaned up by Git later.</p>
      </ConfirmDialog>
    </section>
  );
}
