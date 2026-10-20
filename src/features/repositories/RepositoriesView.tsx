import { useMemo, useState } from "react";
import { DownloadCloud, FolderGit2, FolderOpen, FolderPlus, FolderSearch, MoreHorizontal, Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { RepoRecord } from "@/bindings/RepoRecord";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { useRepoActions } from "@/features/onboarding/RepoActions";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { useStore } from "@/store/AppStore";

export function RepositoriesView() {
  const { repos, activeRepo, openRepo, refreshRepos, notify, setPage } = useStore();
  const { addExisting, startClone, createNew, relocate } = useRepoActions();
  const [q, setQ] = useState("");
  const [remove, setRemove] = useState<RepoRecord | null>(null);
  const [rename, setRename] = useState<RepoRecord | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return f ? repos.filter((r) => r.name.toLowerCase().includes(f) || r.path.toLowerCase().includes(f)) : repos;
  }, [repos, q]);

  const items = (r: RepoRecord): MenuItem[] => [
    { label: "Open", icon: <FolderOpen size={14} />, disabled: !r.available, onSelect: () => void openRepo(r.id) },
    { label: "Rename in GitPilot…", icon: <Pencil size={14} />, onSelect: () => setRename(r) },
    { label: "Locate folder…", icon: <FolderSearch size={14} />, onSelect: () => void relocate(r) },
    { type: "separator" },
    { label: "Remove from GitPilot…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setRemove(r) },
  ];

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Repositories</h2>
          <Button icon={<FolderOpen size={14} />} onClick={() => void addExisting()}>Open…</Button>
          <Button icon={<DownloadCloud size={14} />} onClick={startClone}>Clone…</Button>
          <Button icon={<FolderPlus size={14} />} onClick={() => void createNew()}>New…</Button>
        </div>
        {repos.length > 6 && <SearchField className="mt-4 w-72" label="Filter repositories" placeholder="Filter repositories" value={q} onChange={setQ} />}
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          {repos.length === 0 && <p className="px-4 py-6 text-center text-base text-muted">No repositories yet. Open, clone or create one to get started.</p>}
          {repos.length > 0 && list.length === 0 && <p className="px-4 py-6 text-center text-base text-muted">No repositories match “{q}”.</p>}
          {list.map((r) => (
            <div
              key={r.id}
              onDoubleClick={() => r.available && void openRepo(r.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, items: items(r) });
              }}
              className={cx("group flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-2", r.id === activeRepo?.id && "bg-accent-soft/40")}
            >
              {r.available ? <FolderGit2 size={16} className="shrink-0 text-muted" /> : <TriangleAlert size={16} className="shrink-0 text-warning" aria-label="Folder missing" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-medium">{r.name}</span>
                  {r.id === activeRepo?.id && <span className="text-xs text-accent-text">open</span>}
                </div>
                <p className="selectable truncate font-mono text-xs text-faint" title={r.path}>{r.path}</p>
                {!r.available && <p className="text-sm text-warning">The folder was moved or deleted. Locate it, or remove it from GitPilot.</p>}
              </div>
              <span className="shrink-0 text-sm text-faint">{r.lastOpenedAt ? `opened ${relativeTime(r.lastOpenedAt)}` : "never opened"}</span>
              {r.available ? (
                <Button size="sm" onClick={() => void openRepo(r.id)}>Open</Button>
              ) : (
                <Button size="sm" onClick={() => void relocate(r)}>Locate…</Button>
              )}
              <IconButton size="sm" label={`More actions for ${r.name}`} icon={<MoreHorizontal size={14} />} onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                setMenu({ at: { x: b.right - 220, y: b.bottom + 2 }, items: items(r) });
              }} />
            </div>
          ))}
        </div>
      </div>
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}
      <ConfirmDialog
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={`Remove ${remove?.name} from GitPilot?`}
        confirmLabel="Remove from list"
        onConfirm={async () => {
          if (!remove) return;
          try {
            await api.repoRemove(remove.id);
            await refreshRepos();
            notify({ tone: "success", title: `Removed ${remove.name} from GitPilot` });
            if (remove.id === activeRepo?.id) setPage("repositories");
          } catch (e) {
            notify({ tone: "error", title: "Couldn't remove the repository", error: toAppError(e) });
            throw e;
          }
        }}
      >
        <p>The repository stays on disk at <span className="selectable font-mono text-xs">{remove?.path}</span>. Only GitPilot's entry is removed.</p>
      </ConfirmDialog>
      {rename && <RenameRepoDialog repo={rename} onClose={() => setRename(null)} />}
    </div>
  );
}

function RenameRepoDialog({ repo, onClose }: { repo: RepoRecord; onClose: () => void }) {
  const { refreshRepos } = useStore();
  const [name, setName] = useState(repo.name);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title="Rename in GitPilot"
      description="Changes the display name only. The folder isn't renamed."
      onSubmit={async () => {
        setBusy(true);
        try {
          await api.repoRename(repo.id, name);
          await refreshRepos();
          onClose();
        } catch (e) {
          setError(toAppError(e));
        } finally {
          setBusy(false);
        }
      }}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Rename</Button></>}
    >
      <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      {error && <ErrorNotice className="mt-3" error={error} />}
    </Dialog>
  );
}
