import { useMemo, useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  Check,
  CloudOff,
  CopyPlus,
  Download,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  GitBranchPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unlink,
} from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { Branch } from "@/bindings/Branch";
import type { BranchComparison } from "@/bindings/BranchComparison";
import type { Stash } from "@/bindings/Stash";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural, relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { TagsSection } from "./TagsSection";
import { BackupsSection } from "./BackupsSection";
import { RecoverSection } from "./RecoverSection";
import { WorktreesSection } from "./WorktreesSection";
import { CompareFilesDialog, type CompareTarget } from "@/features/compare/CompareFilesDialog";
import { useIntegrate } from "@/lib/useIntegrate";
import { useStore } from "@/store/AppStore";
import { branchNameProblem, NewBranchDialog } from "./NewBranchDialog";
import { useBranchSwitch } from "./useBranchSwitch";

type Pending =
  | { kind: "delete"; b: Branch }
  | { kind: "deleteRemote"; b: Branch }
  | { kind: "rename"; b: Branch }
  | { kind: "upstream"; b: Branch }
  | { kind: "checkoutRemote"; b: Branch }
  | { kind: "compare"; b: Branch }
  | { kind: "merge"; b: Branch }
  | { kind: "rebase"; b: Branch }
  | { kind: "dropStash"; s: Stash }
  | null;

function TrackInfo({ b }: { b: Branch }) {
  if (b.isRemote) return null;
  if (b.upstreamGone) return <Badge tone="warning" title="The remote branch it tracked was deleted">upstream gone</Badge>;
  if (!b.upstream) return <span className="text-xs text-faint">local only</span>;
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-faint">
      <span className="truncate">{b.upstream}</span>
      {(b.ahead ?? 0) > 0 && <span className="text-text">↑{b.ahead}</span>}
      {(b.behind ?? 0) > 0 && <span className="text-text">↓{b.behind}</span>}
    </span>
  );
}

export function BranchesView() {
  const { activeRepo, status, revision, run, busy } = useStore();
  const id = activeRepo?.id;
  const branches = useAsync(() => api.branches(id!), [id, revision], id != null);
  const stashes = useAsync(() => api.stashList(id!), [id, revision], id != null);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const { request: switchTo, dialog: switchDialog } = useBranchSwitch();
  const integrate = useIntegrate();

  const { local, remote } = useMemo(() => {
    const all = branches.data ?? [];
    const f = q.trim().toLowerCase();
    const m = (b: Branch) => !f || b.name.toLowerCase().includes(f);
    return { local: all.filter((b) => !b.isRemote && m(b)), remote: all.filter((b) => b.isRemote && m(b)) };
  }, [branches.data, q]);

  if (!activeRepo || id == null) return null;
  const current = status?.branch.head ?? null;
  const canIntegrate = !!current && status?.state === "normal" && !status.branch.unborn;
  const integrateItems = (b: Branch): MenuItem[] =>
    b.isCurrent
      ? []
      : [
          { type: "separator" },
          {
            label: `Merge into ${current ?? "current branch"}…`,
            icon: <GitMerge size={14} />,
            hint: b.merged ? "already merged" : undefined,
            disabled: !canIntegrate || b.merged === true,
            onSelect: () => setPending({ kind: "merge", b }),
          },
          { label: `Rebase ${current ?? "current branch"} onto this…`, icon: <GitPullRequestArrow size={14} />, disabled: !canIntegrate, onSelect: () => setPending({ kind: "rebase", b }) },
        ];

  const itemsFor = (b: Branch): MenuItem[] =>
    b.isRemote
      ? [
          { label: "Check out as local branch…", icon: <Download size={14} />, onSelect: () => setPending({ kind: "checkoutRemote", b }) },
          { label: `Compare with ${current ?? "HEAD"}`, icon: <ArrowLeftRight size={14} />, onSelect: () => setPending({ kind: "compare", b }) },
          ...integrateItems(b),
          { type: "separator" },
          { label: `Delete from ${b.remote}…`, icon: <CloudOff size={14} />, danger: true, onSelect: () => setPending({ kind: "deleteRemote", b }) },
        ]
      : [
          { label: "Switch to branch", icon: <Check size={14} />, disabled: b.isCurrent, onSelect: () => switchTo({ kind: "local", name: b.name }) },
          { label: `Compare with ${current ?? "HEAD"}`, icon: <ArrowLeftRight size={14} />, disabled: b.isCurrent, onSelect: () => setPending({ kind: "compare", b }) },
          { label: "Rename…", icon: <Pencil size={14} />, onSelect: () => setPending({ kind: "rename", b }) },
          { label: b.upstream ? "Change upstream…" : "Set upstream…", icon: <Link2 size={14} />, onSelect: () => setPending({ kind: "upstream", b }) },
          ...(b.upstream
            ? [{ label: "Stop tracking upstream", icon: <Unlink size={14} />, onSelect: () => void run("Unset upstream", () => api.branchSetUpstream(id, b.name, null), { success: `${b.name} no longer tracks ${b.upstream}` }) }]
            : []),
          ...integrateItems(b),
          { type: "separator" },
          { label: "Delete…", icon: <Trash2 size={14} />, danger: true, disabled: b.isCurrent, onSelect: () => setPending({ kind: "delete", b }) },
        ];

  const row = (b: Branch) => (
    <div
      key={b.fullRef}
      role="row"
      onDoubleClick={() => (b.isRemote ? setPending({ kind: "checkoutRemote", b }) : !b.isCurrent && switchTo({ kind: "local", name: b.name }))}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ at: { x: e.clientX, y: e.clientY }, items: itemsFor(b) });
      }}
      className={cx("group grid items-center gap-3 border-b border-border px-4 hover:bg-surface-2", b.isCurrent && "bg-accent-soft/50")}
      style={{ gridTemplateColumns: "minmax(180px, 1.2fr) minmax(120px, 0.8fr) minmax(160px, 1.4fr) 90px 64px", height: 36 }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {b.isCurrent ? <Check size={14} className="shrink-0 text-accent-text" aria-label="Current branch" /> : <GitBranch size={14} className="shrink-0 text-faint" />}
        <span className={cx("truncate font-mono text-sm", b.isCurrent && "font-medium")} title={b.name}>{b.name}</span>
        {!b.isRemote && b.merged === true && !b.isCurrent && <Badge title={`Fully merged into ${current ?? "HEAD"}`}>merged</Badge>}
      </span>
      <span className="min-w-0"><TrackInfo b={b} /></span>
      <span className="truncate text-sm text-muted" title={b.subject}>{b.subject}</span>
      <span className="text-right text-xs text-faint">{relativeTime(b.lastCommitTime)}</span>
      <span className="flex justify-end gap-0.5">
        {!b.isRemote && !b.isCurrent && (
          <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus:opacity-100" disabled={!!busy} onClick={() => switchTo({ kind: "local", name: b.name })}>
            Switch
          </Button>
        )}
        <IconButton size="sm" label={`Actions for ${b.name}`} icon={<MoreHorizontal size={14} />} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ at: { x: r.right - 220, y: r.bottom + 2 }, items: itemsFor(b) });
        }} />
      </span>
    </div>
  );

  const group = (title: string, list: Branch[], empty: string) => (
    <section aria-label={title}>
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 px-4 text-sm font-semibold text-muted">
        {title} <span className="font-normal text-faint">{list.length}</span>
      </h3>
      {list.length ? <div role="table">{list.map(row)}</div> : <p className="px-4 py-3 text-base text-muted">{empty}</p>}
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <SearchField label="Filter branches" placeholder="Filter branches" value={q} onChange={setQ} className="w-72" />
        <span className="flex-1" />
        <Button variant="primary" icon={<GitBranchPlus size={14} />} onClick={() => setNewOpen(true)} disabled={status?.branch.unborn}>
          New branch
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {branches.error && <ErrorNotice className="m-4" error={branches.error} />}
        {branches.loading && !branches.data && <div className="flex justify-center p-6"><Spinner label="Loading branches" /></div>}
        {branches.data && (
          <>
            {status?.branch.unborn && (
              <EmptyState className="h-auto" icon={<GitBranch size={22} />} title="No branches yet">
                Make your first commit, then you can create and switch branches.
              </EmptyState>
            )}
            {!status?.branch.unborn && group("Local", local, q ? `No local branches match “${q}”.` : "No local branches.")}
            {!status?.branch.unborn && group("Remote", remote, q ? `No remote branches match “${q}”.` : "No remote-tracking branches. Add a remote and fetch to see them.")}
            <section aria-label="Stashes">
              <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 px-4 text-sm font-semibold text-muted">
                Stashes <span className="font-normal text-faint">{stashes.data?.length ?? 0}</span>
              </h3>
              {stashes.data?.length ? (
                stashes.data.map((s) => (
                  <div key={s.reference} className="flex h-9 items-center gap-3 border-b border-border px-4">
                    <Archive size={14} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-sm">{s.message}</span>
                    <span className="text-xs text-faint">{relativeTime(s.time)}</span>
                    <Button size="sm" disabled={!!busy} onClick={() => void run("Apply stash", () => api.stashApply(id, s.index, true), { success: "Stash applied and removed" })}>
                      Restore
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Apply stash", () => api.stashApply(id, s.index, false), { success: "Stash applied (kept in list)" })}>
                      Apply copy
                    </Button>
                    <IconButton size="sm" tone="danger" label="Delete stash…" icon={<Trash2 size={13} />} onClick={() => setPending({ kind: "dropStash", s })} />
                  </div>
                ))
              ) : (
                <p className="px-4 py-3 text-base text-muted">No stashes. Stashing saves uncommitted changes so you can switch branches with a clean working tree.</p>
              )}
            </section>
            <TagsSection query={q} />
            <WorktreesSection />
            <RecoverSection />
            <BackupsSection />
          </>
        )}
      </div>

      <NewBranchDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {switchDialog}
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}

      <ConfirmDialog
        open={pending?.kind === "delete"}
        onClose={() => setPending(null)}
        danger
        title={`Delete ${pending?.kind === "delete" ? pending.b.name : ""}?`}
        confirmLabel="Delete branch"
        acknowledge={pending?.kind === "delete" && pending.b.merged === false ? "I understand its unmerged commits may be lost" : undefined}
        onConfirm={async () => {
          if (pending?.kind !== "delete") return;
          const b = pending.b;
          await run("Delete branch", () => api.branchDelete(id, b.name, b.merged === false), { success: `Deleted ${b.name}`, rethrow: true });
        }}
      >
        {pending?.kind === "delete" &&
          (pending.b.merged === false ? (
            <p>
              <span className="font-medium text-warning">This branch isn't merged into {current ?? "HEAD"}.</span> Deleting it removes the only local
              name for its commits{pending.b.upstream && !pending.b.upstreamGone ? ` (they still exist on ${pending.b.upstream})` : ""}. GitPilot keeps a
              backup of its last commit under Backups, so you can create the branch again from there.
            </p>
          ) : (
            <p>The branch is fully merged into {current ?? "HEAD"}, so no commits are lost. The remote branch, if any, isn't touched.</p>
          ))}
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "deleteRemote"}
        onClose={() => setPending(null)}
        danger
        title={`Delete ${pending?.kind === "deleteRemote" ? pending.b.name : ""} from the remote?`}
        confirmLabel="Delete from remote"
        acknowledge="I understand this affects everyone using this remote"
        onConfirm={async () => {
          if (pending?.kind !== "deleteRemote") return;
          const b = pending.b;
          const remoteName = b.remote ?? "origin";
          const branch = b.name.slice(remoteName.length + 1);
          await run("Delete remote branch", () => api.branchDeleteRemote(id, remoteName, branch), { success: `Deleted ${b.name}`, rethrow: true });
        }}
      >
        <p>This pushes a deletion to the server. Other people who use this remote will lose access to the branch unless they have a copy.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "dropStash"}
        onClose={() => setPending(null)}
        danger
        title="Delete this stash?"
        confirmLabel="Delete stash"
        onConfirm={async () => {
          if (pending?.kind !== "dropStash") return;
          await run("Delete stash", () => api.stashDrop(id, pending.s.index), { success: "Stash deleted", rethrow: true });
        }}
      >
        <p>The saved changes “{pending?.kind === "dropStash" ? pending.s.message : ""}” will be removed permanently.</p>
      </ConfirmDialog>

      {pending?.kind === "rename" && <RenameDialog b={pending.b} onClose={() => setPending(null)} />}
      {pending?.kind === "upstream" && <UpstreamDialog b={pending.b} remotes={(branches.data ?? []).filter((x) => x.isRemote)} onClose={() => setPending(null)} />}
      {pending?.kind === "checkoutRemote" && (
        <CheckoutRemoteDialog
          b={pending.b}
          existing={(branches.data ?? []).filter((x) => !x.isRemote).map((x) => x.name)}
          onClose={() => setPending(null)}
          onCheckout={(localName) => {
            setPending(null);
            switchTo({ kind: "remote", remoteBranch: pending.b.name, localName });
          }}
        />
      )}
      {pending?.kind === "compare" && current && <CompareDialog base={current} head={pending.b.name} onClose={() => setPending(null)} />}

      <ConfirmDialog
        open={pending?.kind === "merge"}
        onClose={() => setPending(null)}
        title={`Merge ${pending?.kind === "merge" ? pending.b.name : ""} into ${current ?? ""}?`}
        confirmLabel="Merge"
        onConfirm={async () => {
          if (pending?.kind !== "merge") return;
          const b = pending.b;
          await integrate("Merge", () => api.branchMerge(id, b.name), `Merged ${b.name} into ${current}`);
        }}
      >
        <p>
          Brings the commits from <span className="font-mono">{pending?.kind === "merge" ? pending.b.name : ""}</span> into{" "}
          <span className="font-mono">{current}</span>. Git fast-forwards when it can, otherwise it creates a merge commit. If both branches
          changed the same lines, Git stops so you can resolve the conflicts, or abort.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "rebase"}
        onClose={() => setPending(null)}
        danger
        title={`Rebase ${current ?? ""} onto ${pending?.kind === "rebase" ? pending.b.name : ""}?`}
        confirmLabel="Rebase"
        acknowledge={status?.branch.upstream ? `I understand ${current} will need a force push afterwards` : undefined}
        onConfirm={async () => {
          if (pending?.kind !== "rebase") return;
          const b = pending.b;
          await integrate("Rebase", () => api.branchRebase(id, b.name), `Rebased ${current} onto ${b.name}`);
        }}
      >
        <p>
          Replays the commits on <span className="font-mono">{current}</span> on top of{" "}
          <span className="font-mono">{pending?.kind === "rebase" ? pending.b.name : ""}</span>, creating new commits with new ids. This rewrites
          the history of <span className="font-mono">{current}</span>; <span className="font-mono">{pending?.kind === "rebase" ? pending.b.name : ""}</span> isn't changed.
        </p>
        {status?.branch.upstream && (
          <p className="mt-2 text-warning">
            {current} is published to {status.branch.upstream}. After rebasing, pushing will require a force push, which affects anyone else using that
            branch.
          </p>
        )}
        <p className="mt-2">Commit or stash your uncommitted changes first. If a commit conflicts, Git pauses; you can resolve it, skip it, or abort to get your branch back exactly as it was.</p>
      </ConfirmDialog>
    </div>
  );
}

function RenameDialog({ b, onClose }: { b: Branch; onClose: () => void }) {
  const { activeRepo, run } = useStore();
  const [name, setName] = useState(b.name);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = branchNameProblem(name);
  const save = async () => {
    if (!activeRepo || problem || name.trim() === b.name) return;
    setBusy(true);
    try {
      await run("Rename branch", () => api.branchRename(activeRepo.id, b.name, name.trim()), { rethrow: true, quiet: true, success: `Renamed to ${name.trim()}` });
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={`Rename ${b.name}`}
      description={b.upstream ? `The upstream on the remote (${b.upstream}) keeps its old name. Push the renamed branch to publish it under the new name.` : "Only the local branch is renamed."}
      onSubmit={save}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!!problem || !name.trim() || name.trim() === b.name}>Rename</Button></>}
    >
      <Field label="New name" error={problem}>{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />}</Field>
      {error && <ErrorNotice className="mt-3" error={error} />}
    </Dialog>
  );
}

function UpstreamDialog({ b, remotes, onClose }: { b: Branch; remotes: Branch[]; onClose: () => void }) {
  const { activeRepo, run } = useStore();
  const guess = remotes.find((r) => r.name.endsWith(`/${b.name}`))?.name ?? remotes[0]?.name ?? "";
  const [up, setUp] = useState(b.upstream ?? guess);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!activeRepo || !up) return;
    setBusy(true);
    try {
      await run("Set upstream", () => api.branchSetUpstream(activeRepo.id, b.name, up), { rethrow: true, quiet: true, success: `${b.name} now tracks ${up}` });
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={`Upstream for ${b.name}`}
      description="The upstream is the remote branch that Pull and Push use by default, and that ahead/behind counts compare against."
      onSubmit={save}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!up}>Set upstream</Button></>}
    >
      {remotes.length ? (
        <Field label="Remote branch">
          {(p) => (
            <Select {...p} value={up} onChange={(e) => setUp(e.target.value)} className="font-mono text-sm">
              {remotes.map((r) => <option key={r.fullRef} value={r.name}>{r.name}</option>)}
            </Select>
          )}
        </Field>
      ) : (
        <p className="text-base text-muted">There are no remote branches yet. Publish this branch with Push, or fetch from a remote first.</p>
      )}
      {error && <ErrorNotice className="mt-3" error={error} />}
    </Dialog>
  );
}

function CheckoutRemoteDialog({ b, existing, onClose, onCheckout }: { b: Branch; existing: string[]; onClose: () => void; onCheckout: (name: string) => void }) {
  const short = b.remote ? b.name.slice(b.remote.length + 1) : b.name;
  const [name, setName] = useState(short);
  const exists = existing.includes(name.trim());
  const problem = branchNameProblem(name) ?? (exists ? `A local branch named ${name.trim()} already exists. Choose another name, or switch to it instead.` : null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Check out ${b.name}`}
      description={`Creates a local branch that tracks ${b.name} and switches to it.`}
      onSubmit={() => !problem && name.trim() && onCheckout(name.trim())}
      footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!!problem || !name.trim()}>Check out</Button></>}
    >
      <Field label="Local branch name" error={problem}>{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />}</Field>
    </Dialog>
  );
}

function CompareDialog({ base, head, onClose }: { base: string; head: string; onClose: () => void }) {
  const { activeRepo, status, busy } = useStore();
  const integrate = useIntegrate();
  const [swap, setSwap] = useState(false);
  const [b, h] = swap ? [head, base] : [base, head];
  const cmp = useAsync<BranchComparison>(() => api.branchCompare(activeRepo!.id, b, h), [b, h], !!activeRepo);
  const current = status?.branch.head;
  const [files, setFiles] = useState<CompareTarget | null>(null);
  const list = (title: string, items: BranchComparison["ahead"], pickable = false) => (
    <div className="min-w-0 flex-1">
      <h4 className="mb-1 text-sm font-semibold text-muted">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-faint">None</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded border border-border">
          {items.map((c) => (
            <li key={c.hash} className="group flex items-center gap-2 border-b border-border px-2 py-1 text-sm last:border-b-0">
              <span className="font-mono text-xs text-faint">{c.shortHash}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              {pickable && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<CopyPlus size={12} />}
                  disabled={!!busy || status?.state !== "normal"}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title={`Apply this commit on top of ${current}`}
                  onClick={async () => {
                    if (activeRepo && (await integrate("Cherry-pick", () => api.commitCherryPick(activeRepo.id, c.hash), `Cherry-picked ${c.shortHash} onto ${current}`)))
                      void cmp.reload();
                  }}
                >
                  Cherry-pick
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      width={720}
      title="Compare branches"
      description={<span className="font-mono text-sm">{b} … {h}</span>}
      footer={<><Checkbox checked={swap} onChange={setSwap} label="Swap sides" className="mr-auto" /><Button onClick={() => setFiles({ base: b, head: h })}>Compare files…</Button><Button variant="primary" onClick={onClose}>Done</Button></>}
    >
      <CompareFilesDialog target={files} onClose={() => setFiles(null)} />
      {cmp.error && <ErrorNotice error={cmp.error} />}
      {cmp.loading && !cmp.data && <div className="flex justify-center p-4"><Spinner /></div>}
      {cmp.data && (
        <>
          <p className="mb-3 text-base text-muted">
            {h} has {plural(cmp.data.ahead.length, "commit")} that {b} doesn't, and is missing {plural(cmp.data.behind.length, "commit")} from {b}
            {cmp.data.ahead.length >= 200 || cmp.data.behind.length >= 200 ? " (lists are capped at 200)" : ""}.
          </p>
          <div className="flex gap-4">
            {list(`Only on ${h}`, cmp.data.ahead, b === current)}
            {list(`Only on ${b}`, cmp.data.behind)}
          </div>
        </>
      )}
    </Dialog>
  );
}
