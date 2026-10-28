import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, GitBranchPlus, History, LifeBuoy, Trash2 } from "lucide-react";
import type { Backup } from "@/bindings/Backup";
import type { ReflogEntry } from "@/bindings/ReflogEntry";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Misc";
import { ResetDialog } from "@/features/history/ResetDialog";
import { api } from "@/lib/api";
import { absoluteTime, relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { NewBranchDialog } from "./NewBranchDialog";

/** Plain-language description of what moved HEAD to this entry. */
export function describeReflog(e: Pick<ReflogEntry, "action" | "message">): string {
  const { action: a, message: m } = e;
  if (a === "commit") return "Committed";
  if (a === "commit (initial)") return "First commit";
  if (a === "commit (amend)") return "Amended the last commit";
  if (a === "commit (merge)") return "Committed a merge";
  if (a === "checkout") {
    const sw = /^moving from (.+) to (.+)$/.exec(m);
    return sw ? `Switched from ${sw[1]} to ${sw[2]}` : "Switched branch";
  }
  if (a === "reset") return m.startsWith("moving to ") ? `Reset to ${m.slice("moving to ".length)}` : "Reset";
  if (a === "rebase (finish)") return "Finished a rebase";
  if (a === "rebase (start)") return "Started a rebase";
  if (a.startsWith("rebase")) return "Rebase step";
  if (a.startsWith("merge ")) return `Merged ${a.slice("merge ".length)}`;
  if (a.startsWith("pull")) return "Pulled";
  if (a.startsWith("cherry-pick")) return "Cherry-picked a commit";
  if (a.startsWith("revert")) return "Reverted a commit";
  return m ? `${a}: ${m}` : a;
}

let focusOnMount = false;
/** Call before switching to Branches to scroll the Recover section into view. */
export function focusRecoverSection() {
  focusOnMount = true;
}

export type RecoverRow = { kind: "reflog"; e: ReflogEntry; time: number } | { kind: "backup"; b: Backup; time: number };

/** Reflog entries and GitPilot backups in one list, newest first. Backups always pass the "lost" filter: they are the safety copies. */
export function recoverRows(reflog: ReflogEntry[], backups: Backup[], onlyLost: boolean): RecoverRow[] {
  const rows: RecoverRow[] = [
    ...reflog.filter((e) => !onlyLost || e.lost).map((e) => ({ kind: "reflog" as const, e, time: e.time })),
    ...backups.map((b) => ({ kind: "backup" as const, b, time: b.time })),
  ];
  // Stable sort keeps the reflog's own order for entries in the same second.
  return rows.sort((a, b) => b.time - a.time);
}

/**
 * Earlier positions of HEAD (the reflog) and the backups GitPilot saved before resets, commit
 * edits and force-deleted branches, in one list: what's needed to bring lost commits back.
 */
export function RecoverSection() {
  const { activeRepo, revision, status, run, busy } = useStore();
  const id = activeRepo?.id;
  const log = useAsync(() => api.reflogList(id!, 200), [id, revision], id != null);
  const backups = useAsync(() => api.backupList(id!), [id, revision], id != null);
  const [onlyLost, setOnlyLost] = useState(false);
  const [branchAt, setBranchAt] = useState<string | null>(null);
  const [resetTo, setResetTo] = useState<{ hash: string; label: string } | null>(null);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [del, setDel] = useState<Backup | null>(null);
  const ref = useRef<HTMLElement>(null);
  const loaded = !!log.data && !!backups.data;
  useEffect(() => {
    if (loaded && focusOnMount) {
      focusOnMount = false;
      ref.current?.scrollIntoView({ block: "start" });
    }
  }, [loaded]);
  const reflog = log.data ?? [];
  const saved = backups.data ?? [];
  if (id == null || (!reflog.length && !saved.length)) return null;
  const rows = recoverRows(reflog, saved, onlyLost);
  const lostCount = reflog.filter((e) => e.lost).length;
  const head = status?.branch.oid;
  const normal = status?.state === "normal";

  return (
    <section ref={ref} aria-label="Recover">
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 px-4 text-sm font-semibold text-muted">
        Recover <span className="font-normal text-faint">{reflog.length + saved.length}</span>
        <span className="flex-1" />
        <Checkbox className="font-normal" checked={onlyLost} onChange={setOnlyLost} label={`Only commits not on any branch (${lostCount})`} />
      </h3>
      <p className="border-b border-border px-4 py-2 text-sm text-muted">
        Everywhere your repository has been recently, and the backups GitPilot saved, newest first. If a reset, rebase or deleted branch lost commits, create a branch at an earlier point or restore a backup to get them back.
      </p>
      {rows.map((r) =>
        r.kind === "reflog" ? (
          <div key={`r-${r.e.index}-${r.e.hash}`} className="flex h-9 items-center gap-3 border-b border-border px-4">
            <LifeBuoy size={14} className="shrink-0 text-faint" />
            <span className="w-56 shrink-0 truncate text-sm text-muted" title={r.e.message ? `${r.e.action}: ${r.e.message}` : r.e.action}>
              {describeReflog(r.e)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{r.e.subject}</span>
            {r.e.lost && <Badge tone="warning" title="No branch, tag or remote branch contains this commit">not on a branch</Badge>}
            {r.e.hash === head && <Badge tone="accent">current</Badge>}
            <span className="font-mono text-xs text-faint">{r.e.hash.slice(0, 7)}</span>
            <span className="w-20 text-right text-xs text-faint" title={absoluteTime(r.e.time)}>{relativeTime(r.e.time)}</span>
            <IconButton size="sm" label="Create branch here…" icon={<GitBranchPlus size={13} />} onClick={() => setBranchAt(r.e.hash)} />
            <IconButton
              size="sm"
              label="Reset current branch here…"
              icon={<History size={13} />}
              disabled={r.e.hash === head || !normal}
              onClick={() => setResetTo({ hash: r.e.hash, label: `${r.e.hash.slice(0, 7)} · ${r.e.subject}` })}
            />
          </div>
        ) : (
          <div key={`b-${r.b.name}`} className="flex h-9 items-center gap-3 border-b border-border px-4">
            <ArchiveRestore size={14} className="shrink-0 text-faint" />
            <span className="w-56 shrink-0 truncate text-sm text-muted" title={r.b.label}>
              Backup {r.b.label ? `(${r.b.label})` : ""}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {r.b.subject}
              {r.b.wip && <span className="ml-2 text-xs text-faint">+ uncommitted changes</span>}
            </span>
            <Badge title="Saved by GitPilot under refs/gitpilot/backups">backup</Badge>
            <span className="font-mono text-xs text-faint">{r.b.hash.slice(0, 7)}</span>
            <span className="w-20 text-right text-xs text-faint" title={absoluteTime(r.b.time)}>{relativeTime(r.b.time)}</span>
            <Button size="sm" disabled={!!busy || !normal} onClick={() => setRestore(r.b)}>
              Restore
            </Button>
            <IconButton size="sm" label="Create branch from this backup…" icon={<GitBranchPlus size={13} />} onClick={() => setBranchAt(r.b.hash)} />
            <IconButton size="sm" tone="danger" label="Delete backup…" icon={<Trash2 size={13} />} onClick={() => setDel(r.b)} />
          </div>
        ),
      )}
      {rows.length === 0 && <p className="px-4 py-3 text-base text-muted">Every recent commit is still on a branch.</p>}
      <NewBranchDialog open={branchAt !== null} onClose={() => setBranchAt(null)} startPoint={branchAt ?? undefined} />
      <ResetDialog target={resetTo} onClose={() => setResetTo(null)} />
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
