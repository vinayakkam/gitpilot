import { Download, FolderGit2, Package, RefreshCw } from "lucide-react";
import type { Submodule } from "@/bindings/Submodule";
import type { SubmoduleState } from "@/bindings/SubmoduleState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, ErrorNotice } from "@/components/ui/Misc";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

const STATE: Record<SubmoduleState, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  upToDate: { label: "Up to date", tone: "success" },
  notInitialized: { label: "Not downloaded", tone: "neutral" },
  differentCommit: { label: "Different commit checked out", tone: "warning" },
  conflict: { label: "Conflict", tone: "danger" },
};

/** Submodules of the open repository; hidden when there are none. */
export function SubmodulesSection() {
  const { activeRepo, revision, run, busy, openRepo, refreshRepos, notify } = useStore();
  const id = activeRepo?.id;
  const subs = useAsync(() => api.submoduleList(id!), [id, revision], id != null);
  if (id == null || !activeRepo) return null;
  if (subs.error) return <ErrorNotice className="mt-8" error={subs.error} />;
  const list = subs.data ?? [];
  if (list.length === 0) return null;

  const update = (paths: string[], label: string) =>
    void run(label, () => api.submoduleUpdate(id, paths), { success: paths.length ? `Updated ${paths.join(", ")}` : "Submodules updated" });

  const open = async (s: Submodule) => {
    try {
      const rec = await api.repoAdd(`${activeRepo.path}/${s.path}`);
      await refreshRepos();
      await openRepo(rec.id);
    } catch (e) {
      notify({ tone: "error", title: "Couldn't open the submodule", error: toAppError(e) });
    }
  };

  const needsWork = list.some((s) => s.state !== "upToDate");
  return (
    <section className="mt-8" aria-label="Submodules">
      <div className="flex items-center justify-between">
        <h3 className="text-md font-semibold">Submodules</h3>
        <Button size="sm" variant={needsWork ? "primary" : "secondary"} icon={<Download size={12} />} disabled={!!busy} loading={busy === "Update submodules"} onClick={() => update([], "Update submodules")}>
          Update all
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">Other repositories this one includes at a fixed commit. Updating downloads them if needed and checks out the commit this repository records.</p>
      <div className="mt-2 overflow-hidden rounded-md border border-border">
        {list.map((s) => (
          <div key={s.path} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <Package size={16} className="mt-0.5 shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-medium">{s.path}</span>
                <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
                {s.branch && <span className="text-sm text-faint">tracks {s.branch}</span>}
              </div>
              <div className="selectable mt-1 truncate text-sm text-muted">
                <span className="font-mono text-xs">{s.commit.slice(0, 10)}</span>
                {s.describe && <span className="ml-2">{s.describe}</span>}
                {s.url && <span className="ml-2 font-mono text-xs text-faint">{s.url}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {s.state !== "upToDate" && (
                <Button size="sm" icon={<RefreshCw size={12} />} disabled={!!busy} onClick={() => update([s.path], `Update ${s.path}`)}>
                  {s.state === "notInitialized" ? "Download" : "Update"}
                </Button>
              )}
              {s.state !== "notInitialized" && <IconButton size="sm" label={`Open ${s.path} in GitPilot`} icon={<FolderGit2 size={13} />} onClick={() => void open(s)} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
