import { useEffect, useRef, useState } from "react";
import { GitBranchPlus, History, LifeBuoy } from "lucide-react";
import type { ReflogEntry } from "@/bindings/ReflogEntry";
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

/** Earlier positions of HEAD (the reflog), so commits lost to a reset, rebase or deleted branch can be brought back. */
export function RecoverSection() {
  const { activeRepo, revision, status } = useStore();
  const id = activeRepo?.id;
  const log = useAsync(() => api.reflogList(id!, 200), [id, revision], id != null);
  const [onlyLost, setOnlyLost] = useState(false);
  const [branchAt, setBranchAt] = useState<string | null>(null);
  const [resetTo, setResetTo] = useState<{ hash: string; label: string } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const loaded = !!log.data;
  useEffect(() => {
    if (loaded && focusOnMount) {
      focusOnMount = false;
      ref.current?.scrollIntoView({ block: "start" });
    }
  }, [loaded]);
  if (id == null || !log.data?.length) return null;
  const entries = onlyLost ? log.data.filter((e) => e.lost) : log.data;
  const lostCount = log.data.filter((e) => e.lost).length;
  const head = status?.branch.oid;

  return (
    <section ref={ref} aria-label="Recover">
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 px-4 text-sm font-semibold text-muted">
        Recover <span className="font-normal text-faint">{log.data.length}</span>
        <span className="flex-1" />
        <Checkbox className="font-normal" checked={onlyLost} onChange={setOnlyLost} label={`Only commits not on any branch (${lostCount})`} />
      </h3>
      <p className="border-b border-border px-4 py-2 text-sm text-muted">
        Everywhere your repository has been recently, newest first. If a reset, rebase or deleted branch lost commits, create a branch at an earlier point to get them back.
      </p>
      {entries.map((e) => (
        <div key={`${e.index}-${e.hash}`} className="flex h-9 items-center gap-3 border-b border-border px-4">
          <LifeBuoy size={14} className="shrink-0 text-faint" />
          <span className="w-56 shrink-0 truncate text-sm text-muted" title={e.message ? `${e.action}: ${e.message}` : e.action}>
            {describeReflog(e)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{e.subject}</span>
          {e.lost && <Badge tone="warning" title="No branch, tag or remote branch contains this commit">not on a branch</Badge>}
          {e.hash === head && <Badge tone="accent">current</Badge>}
          <span className="font-mono text-xs text-faint">{e.hash.slice(0, 7)}</span>
          <span className="w-20 text-right text-xs text-faint" title={absoluteTime(e.time)}>{relativeTime(e.time)}</span>
          <IconButton size="sm" label="Create branch here…" icon={<GitBranchPlus size={13} />} onClick={() => setBranchAt(e.hash)} />
          <IconButton
            size="sm"
            label="Reset current branch here…"
            icon={<History size={13} />}
            disabled={e.hash === head || status?.state !== "normal"}
            onClick={() => setResetTo({ hash: e.hash, label: `${e.hash.slice(0, 7)} · ${e.subject}` })}
          />
        </div>
      ))}
      {entries.length === 0 && <p className="px-4 py-3 text-base text-muted">Every recent commit is still on a branch.</p>}
      <NewBranchDialog open={branchAt !== null} onClose={() => setBranchAt(null)} startPoint={branchAt ?? undefined} />
      <ResetDialog target={resetTo} onClose={() => setResetTo(null)} />
    </section>
  );
}
