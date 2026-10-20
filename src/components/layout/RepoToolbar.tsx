import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CloudUpload,
  GitBranch,
  GitBranchPlus,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { Branch } from "@/bindings/Branch";
import type { Remote } from "@/bindings/Remote";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { NewBranchDialog } from "@/features/branches/NewBranchDialog";
import { useBranchSwitch } from "@/features/branches/useBranchSwitch";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural, relativeTime } from "@/lib/format";
import { useStore } from "@/store/AppStore";

function BranchPicker({ anchor, onClose, onNew }: { anchor: DOMRect; onClose: () => void; onNew: () => void }) {
  const { activeRepo } = useStore();
  const { request, dialog } = useBranchSwitch();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRepo) api.branches(activeRepo.id).then(setBranches, () => setBranches([]));
  }, [activeRepo]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", down, true);
    return () => window.removeEventListener("mousedown", down, true);
  }, [onClose]);

  const list = useMemo(
    () => (branches ?? []).filter((b) => !b.isRemote && b.name.toLowerCase().includes(q.trim().toLowerCase())),
    [branches, q],
  );

  const choose = (b: Branch) => {
    onClose();
    if (!b.isCurrent) request({ kind: "local", name: b.name });
  };

  return (
    <>
      {createPortal(
        <div
          ref={ref}
          className="gp-pop fixed z-[80] flex w-[300px] flex-col rounded-md border border-border bg-surface shadow-overlay"
          style={{ left: anchor.left, top: anchor.bottom + 4 }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const b = list[active];
              if (b) choose(b);
            }
          }}
        >
          <div className="border-b border-border p-2">
            <SearchField
              label="Filter branches"
              placeholder="Filter local branches"
              value={q}
              autoFocus
              onChange={(v) => {
                setQ(v);
                setActive(0);
              }}
            />
          </div>
          <div role="listbox" aria-label="Local branches" className="max-h-72 overflow-y-auto py-1">
            {branches === null && (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            )}
            {branches !== null && list.length === 0 && <p className="px-3 py-3 text-base text-muted">No branches match “{q}”.</p>}
            {list.map((b, i) => (
              <button
                key={b.fullRef}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(b)}
                className={cx("flex h-7 w-full items-center gap-2 px-3 text-left text-base", i === active && "bg-surface-2")}
              >
                <span className="w-4 text-accent-text">{b.isCurrent && <Check size={14} aria-label="Current branch" />}</span>
                <span className="flex-1 truncate font-mono text-sm">{b.name}</span>
                {b.ahead ? <span className="text-xs text-faint">↑{b.ahead}</span> : null}
                {b.behind ? <span className="text-xs text-faint">↓{b.behind}</span> : null}
              </button>
            ))}
          </div>
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                onNew();
              }}
              className="flex h-7 w-full items-center gap-2 rounded px-2 text-base hover:bg-surface-2"
            >
              <GitBranchPlus size={14} className="text-muted" /> New branch…
            </button>
          </div>
        </div>,
        document.body,
      )}
      {dialog}
    </>
  );
}

/** Compact branch ↔ upstream "track": the one place the sync state is always visible. */
function SyncStrip({ fetchError }: { fetchError: AppError | null }) {
  const { status } = useStore();
  if (!status) return null;
  const b = status.branch;
<<<<<<< HEAD
  const ops = { rebasing: "Rebase", merging: "Merge", cherryPicking: "Cherry-pick", reverting: "Revert", bisecting: "Bisect" } as const;
  if (status.state !== "normal") return <span className="text-sm text-conflict">{ops[status.state]} in progress</span>;
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  if (b.unborn) return <span className="text-sm text-faint">No commits yet</span>;
  if (b.detached) return <span className="text-sm text-warning">Detached HEAD at {b.oid?.slice(0, 7)}</span>;
  if (!b.upstream) return <span className="text-sm text-faint">Not published to a remote</span>;

  const ahead = b.ahead ?? 0;
  const behind = b.behind ?? 0;
  const fetched = status.lastFetch ? `fetched ${relativeTime(status.lastFetch)}` : "never fetched";
  let state: { text: string; tone: string };
  if (ahead && behind) state = { text: "Diverged", tone: "text-warning" };
  else if (ahead) state = { text: `${plural(ahead, "commit")} to push`, tone: "text-accent-text" };
  else if (behind) state = { text: `${plural(behind, "commit")} to pull`, tone: "text-accent-text" };
  else state = { text: status.lastFetch ? "Up to date" : "Not yet fetched", tone: "text-muted" };

  return (
    <Tooltip
      content={
        <span>
          Comparing with {b.upstream} as of the last fetch ({fetched}). Fetch to check for newer remote commits.
        </span>
      }
    >
      <div className="flex min-w-0 items-center gap-2 text-sm" tabIndex={0} aria-label={`${state.text}, ${b.upstream}, ${fetched}`}>
        <span className="h-px w-4 shrink-0 bg-border-strong" aria-hidden />
        <span className="flex shrink-0 items-center gap-1.5 rounded-sm border border-border px-1.5 font-mono text-xs leading-[18px] text-muted">
          <span className={cx("flex items-center", ahead ? "text-text" : "text-faint")}>
            <ArrowUp size={11} />
            {ahead}
          </span>
          <span className={cx("flex items-center", behind ? "text-text" : "text-faint")}>
            <ArrowDown size={11} />
            {behind}
          </span>
        </span>
        <span className="h-px w-4 shrink-0 bg-border-strong" aria-hidden />
        <span className="truncate font-mono text-xs text-muted">{b.upstream}</span>
        <span className={cx("shrink-0", fetchError ? "text-danger" : state.tone)}>{fetchError ? "Fetch failed" : state.text}</span>
        <span className="hidden shrink-0 text-faint xl:inline">{fetched}</span>
      </div>
    </Tooltip>
  );
}

export function RepoToolbar() {
  const { activeRepo, status, busy, progress, run, revision, refreshStatus, statusLoading } = useStore();
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [newBranch, setNewBranch] = useState(false);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [fetchError, setFetchError] = useState<AppError | null>(null);
  const [pushMenu, setPushMenu] = useState<{ x: number; y: number } | null>(null);
<<<<<<< HEAD
  const [cancelling, setCancelling] = useState(false);
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  const id = activeRepo?.id;

  useEffect(() => {
    setFetchError(null);
  }, [id]);
  useEffect(() => {
    if (id != null) api.remotes(id).then(setRemotes, () => setRemotes([]));
  }, [id, revision]);

<<<<<<< HEAD
  const cancellable = !!busy && /^(Fetch|Push|Force push)/.test(busy);
  const cancel = async () => {
    if (id == null) return;
    setCancelling(true);
    try {
      await api.opCancel(`repo:${id}`);
    } finally {
      window.setTimeout(() => setCancelling(false), 800);
    }
  };

  if (!activeRepo || id == null) return null;
  const b = status?.branch;
  const hasUpstream = Boolean(b?.upstream);
  const midOperation = status?.state !== undefined && status.state !== "normal";
  const canPush = Boolean(b && !b.unborn && !b.detached && !midOperation && (hasUpstream || remotes.length > 0));
=======
  if (!activeRepo || id == null) return null;
  const b = status?.branch;
  const hasUpstream = Boolean(b?.upstream);
  const canPush = Boolean(b && !b.unborn && !b.detached && (hasUpstream || remotes.length > 0));
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  const behind = b?.behind ?? 0;

  const fetch = () =>
    run(
      "Fetch",
      async () => {
        try {
          await api.fetch(id, null);
          setFetchError(null);
        } catch (e) {
          setFetchError(toAppError(e));
          throw e;
        }
      },
      { success: "Fetched from all remotes" },
    );
  const pull = () => run("Pull", () => api.pull(id), { success: "Pulled latest changes" });
  const push = (remote?: string) =>
    run("Push", () => api.push(id, { remote: remote ?? null, setUpstream: !hasUpstream }), {
      success: hasUpstream ? "Pushed" : `Published ${b?.head ?? "branch"}`,
    });

  const pushLabel = hasUpstream ? "Push" : "Publish branch";
  const pushHint = !b
    ? ""
<<<<<<< HEAD
    : midOperation
      ? "Finish or abort the operation in progress first."
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
    : b.unborn
      ? "Make a commit before pushing."
      : b.detached
        ? "Create a branch to push from a detached HEAD."
        : !hasUpstream && remotes.length === 0
          ? "Add a remote in Remotes before publishing."
          : behind
            ? `The remote has ${plural(behind, "commit")} you don't have. Pull first, or the push will be rejected.`
            : hasUpstream
              ? `Push commits to ${b.upstream}`
              : `Publish ${b.head} to ${remotes[0]?.name ?? "a remote"} and track it`;

  const pushItems: MenuItem[] = remotes.map((r) => ({ label: `Publish to ${r.name}`, onSelect: () => void push(r.name) }));

  return (
    <div className="relative shrink-0 border-b border-border bg-surface">
      <div className="flex h-11 items-center gap-2 px-3">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-label={`Current branch: ${b?.head ?? "none"}. Switch branch`}
          onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
          disabled={!status}
          className="flex h-7 max-w-[260px] items-center gap-1.5 rounded border border-border px-2 hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
        >
          <GitBranch size={14} className="shrink-0 text-muted" />
          <span className="truncate font-mono text-sm font-medium">
            {b?.head ?? (b?.detached ? b.oid?.slice(0, 7) : "…")}
          </span>
          <ChevronDown size={13} className="shrink-0 text-faint" />
        </button>
        <div className="min-w-0 flex-1">
          <SyncStrip fetchError={fetchError} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label="Refresh status"
            shortcut="F5"
            icon={statusLoading ? <Spinner size={13} /> : <RotateCw size={14} />}
            onClick={() => void refreshStatus()}
          />
          <Tooltip content={remotes.length ? "Download new commits from all remotes without changing your files" : "No remotes configured"}>
            <span>
              <Button size="md" icon={<RefreshCw size={13} />} onClick={fetch} disabled={!!busy || remotes.length === 0} loading={busy === "Fetch"}>
                Fetch
              </Button>
            </span>
          </Tooltip>
          <Tooltip content={hasUpstream ? `Bring in commits from ${b?.upstream}` : "This branch has no upstream to pull from"}>
            <span>
<<<<<<< HEAD
              <Button size="md" variant={behind > 0 ? "primary" : "secondary"} icon={<ArrowDownToLine size={13} />} onClick={pull} disabled={!!busy || !hasUpstream || midOperation} loading={busy === "Pull"}>
=======
              <Button size="md" variant={behind > 0 ? "primary" : "secondary"} icon={<ArrowDownToLine size={13} />} onClick={pull} disabled={!!busy || !hasUpstream} loading={busy === "Pull"}>
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                Pull{behind ? ` ${behind}` : ""}
              </Button>
            </span>
          </Tooltip>
          <Tooltip content={pushHint}>
            <span>
              <Button
                size="md"
                variant={((b?.ahead ?? 0) > 0 && behind === 0) || (!hasUpstream && canPush) ? "primary" : "secondary"}
                icon={hasUpstream ? <ArrowUpFromLine size={13} /> : <CloudUpload size={13} />}
                disabled={!!busy || !canPush}
                loading={busy === "Push"}
                onClick={(e) => {
                  if (!hasUpstream && remotes.length > 1) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPushMenu({ x: r.right - 200, y: r.bottom + 4 });
                  } else void push();
                }}
              >
                {pushLabel}
                {hasUpstream && b?.ahead ? ` ${b.ahead}` : ""}
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
      {busy && (
        <div className="absolute inset-x-0 bottom-0 flex h-[3px] overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 bg-accent/70" style={{ animation: "gp-slide 1.1s ease-in-out infinite" }} />
        </div>
      )}
<<<<<<< HEAD
      {busy && (progress || cancellable) && (
        <div className="flex items-center gap-2 border-t border-border bg-surface-2 py-1 pl-3 pr-2">
          <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-muted" aria-live="polite">
            {busy}: {progress ?? "connecting…"}
          </span>
          {cancellable && (
            <Button size="sm" variant="ghost" disabled={cancelling} onClick={cancel}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
=======
      {busy && progress && (
        <div className="selectable truncate border-t border-border bg-surface-2 px-3 py-1 font-mono text-xs text-muted" aria-live="polite">
          {busy}: {progress}
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
        </div>
      )}
      {picker && <BranchPicker anchor={picker} onClose={() => setPicker(null)} onNew={() => setNewBranch(true)} />}
      <NewBranchDialog open={newBranch} onClose={() => setNewBranch(false)} />
      {pushMenu && <Menu at={pushMenu} items={pushItems} onClose={() => setPushMenu(null)} />}
    </div>
  );
}
