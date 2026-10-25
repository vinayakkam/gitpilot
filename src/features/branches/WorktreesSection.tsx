import { useMemo, useState } from "react";
import { FolderGit2, FolderPlus, Lock, Trash2 } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { Worktree } from "@/bindings/Worktree";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { pickFolder } from "@/lib/repoFlows";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { branchNameProblem } from "./NewBranchDialog";

/** Joins a folder chosen in the picker and a new folder name, keeping the platform's separator. */
export function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + sep + name;
}

/** Folder name suggested for a worktree: "<repo>-<branch>", with "/" in branch names as "-". */
export function worktreeFolderName(repo: string, branch: string): string {
  return `${repo}-${branch.replace(/[\\/]+/g, "-")}`.replace(/[^\w.-]/g, "-");
}

/** Worktrees: other folders with another branch of this repository checked out. */
export function WorktreesSection() {
  const { activeRepo, status, revision, run, busy, openRepo, refreshRepos, notify } = useStore();
  const id = activeRepo?.id;
  const list = useAsync(() => api.worktreeList(id!), [id, revision], id != null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Worktree | null>(null);
  if (id == null || !activeRepo) return null;
  const wts = list.data ?? [];
  const linked = wts.filter((w) => !w.main);

  const open = async (w: Worktree) => {
    try {
      const rec = await api.repoAdd(w.path);
      await refreshRepos();
      await openRepo(rec.id);
    } catch (e) {
      notify({ tone: "error", title: "Couldn't open the worktree", error: toAppError(e) });
    }
  };

  return (
    <section aria-label="Worktrees">
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 pl-4 pr-2 text-sm font-semibold text-muted">
        <span className="flex-1">
          Worktrees <span className="font-normal text-faint">{linked.length}</span>
        </span>
        {wts.some((w) => w.prunable) && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("Clean up worktrees", () => api.worktreePrune(id), { success: "Removed worktrees whose folders were deleted" })}>
            Clean up
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<FolderPlus size={12} />} disabled={!status || status.branch.unborn} onClick={() => setAdding(true)}>
          New worktree
        </Button>
      </h3>
      {list.error && <ErrorNotice className="m-3" compact error={list.error} />}
      {wts.length > 1 ? (
        wts.map((w) => (
          <div key={w.path} className="flex min-h-9 items-center gap-3 border-b border-border px-4 py-1.5">
            <FolderGit2 size={14} className="shrink-0 text-faint" />
            <span className="w-40 shrink-0 truncate font-mono text-sm" title={w.branch ?? undefined}>
              {w.branch ?? (w.detached ? `detached ${w.head?.slice(0, 7) ?? ""}` : "—")}
            </span>
            <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-muted" title={w.path}>
              {w.path}
            </span>
            {w.current && <Badge tone="accent">open here</Badge>}
            {w.main && <Badge>main</Badge>}
            {w.locked && (
              <Badge tone="warning" title="Locked with git worktree lock">
                <Lock size={10} className="mr-0.5" /> locked
              </Badge>
            )}
            {w.prunable && <Badge tone="warning">folder missing</Badge>}
            {!w.current && !w.prunable && (
              <Button size="sm" onClick={() => void open(w)}>
                Open
              </Button>
            )}
            {!w.main && !w.current && <IconButton size="sm" tone="danger" label={`Remove worktree ${w.branch ?? w.path}…`} icon={<Trash2 size={13} />} onClick={() => setRemoving(w)} />}
          </div>
        ))
      ) : (
        <p className="px-4 py-3 text-base text-muted">No other worktrees. A worktree checks out another branch in its own folder, so you can work on two branches at once without stashing.</p>
      )}

      <NewWorktreeDialog open={adding} onClose={() => setAdding(false)} taken={wts.map((w) => w.branch).filter((b): b is string => !!b)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        danger
        title={`Remove the worktree for ${removing?.branch ?? "this commit"}?`}
        confirmLabel="Remove worktree"
        onConfirm={async () => {
          if (removing) await run("Remove worktree", () => api.worktreeRemove(id, removing.path), { success: "Worktree removed", rethrow: true });
        }}
      >
        <p>
          The folder <span className="font-mono text-sm">{removing?.path}</span> is deleted. The branch and its commits stay in the repository. Git refuses if the folder has changes that aren't committed.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function NewWorktreeDialog({ open, onClose, taken }: { open: boolean; onClose: () => void; taken: string[] }) {
  const { activeRepo, run } = useStore();
  const id = activeRepo?.id;
  const branches = useAsync(() => api.branches(id!), [id, open], open && id != null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [existing, setExisting] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [folder, setFolder] = useState("");
  const [folderTouched, setFolderTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const free = useMemo(() => (branches.data ?? []).filter((b) => !b.isRemote && !taken.includes(b.name)).map((b) => b.name), [branches.data, taken]);
  const branch = mode === "existing" ? existing || free[0] || "" : name.trim();
  const nameProblem = mode === "new" && name ? branchNameProblem(name) : null;
  const suggested = activeRepo && branch ? worktreeFolderName(activeRepo.name, branch) : "";
  const folderName = folderTouched ? folder : suggested;
  const path = parent && folderName.trim() ? joinPath(parent, folderName.trim()) : "";

  const reset = () => {
    setName("");
    setExisting("");
    setFolder("");
    setFolderTouched(false);
    setError(null);
  };

  const submit = async () => {
    if (id == null || !branch || !path || nameProblem) return;
    setBusy(true);
    setError(null);
    try {
      await run("New worktree", () => api.worktreeAdd(id, path, branch, mode === "new", null), { rethrow: true, quiet: true, success: `Checked out ${branch} in ${path}` });
      reset();
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
      width={520}
      title="New worktree"
      description="Check out a branch in its own folder, next to this one. Both share the same history, so commits made in either are visible in both."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!branch || !path || !!nameProblem}>
            Create worktree
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label="Branch"
          value={mode}
          onChange={setMode}
          options={[
            { value: "existing", label: "Existing branch" },
            { value: "new", label: "New branch" },
          ]}
        />
        {mode === "existing" ? (
          <Field label="Branch to check out" hint={free.length ? undefined : "Every local branch is already checked out somewhere. Create a new branch instead."}>
            {(p) => (
              <Select {...p} value={branch} onChange={(e) => setExisting(e.target.value)} disabled={!free.length}>
                {free.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="New branch name" error={nameProblem} hint="Starts from the commit you're on now.">
            {(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />}
          </Field>
        )}
        <Field label="Location" hint="The worktree gets a new folder inside this one.">
          {(p) => (
            <div className="flex gap-2">
              <Input {...p} readOnly value={parent} placeholder="Choose a folder" className="font-mono text-sm" />
              <Button
                onClick={async () => {
                  const f = await pickFolder("Choose where to put the worktree", parent || undefined);
                  if (f) setParent(f);
                }}
              >
                Choose…
              </Button>
            </div>
          )}
        </Field>
        <Field label="Folder name">
          {(p) => (
            <Input
              {...p}
              value={folderName}
              onChange={(e) => {
                setFolderTouched(true);
                setFolder(e.target.value);
              }}
              className="font-mono text-sm"
            />
          )}
        </Field>
        {path && <p className="selectable truncate font-mono text-xs text-muted">{path}</p>}
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
