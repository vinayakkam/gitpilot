import { useEffect, useMemo, useState } from "react";
import { CircleCheck } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "@/bindings/AppError";
import type { FileDiff } from "@/bindings/FileDiff";
import type { FileEntry } from "@/bindings/FileEntry";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Splitter, usePanelWidth } from "@/components/ui/Splitter";
import { DiffViewer, stageHunkIcon, unstageHunkIcon } from "@/features/diff/DiffViewer";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";
import { CommitComposer } from "./CommitComposer";
import { FileList, keyOf, type FileListActions } from "./FileList";
import { OperationBanner } from "./OperationBanner";

export function ChangesView() {
  const { activeRepo, status, statusError, settings, saveSettings, run, busy, notify, revision, setSection, setHistoryPath, info } = useStore();
  const id = activeRepo?.id;
  const [width, setWidth] = usePanelWidth("changes", 340, 260, 620);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<AppError | null>(null);
  const [discard, setDiscard] = useState<FileEntry[] | null>(null);

  const files = useMemo(() => status?.files ?? [], [status]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const focused = useMemo(() => files.find((f) => keyOf(f) === focusKey) ?? null, [files, focusKey]);
  const stagedCount = files.filter((f) => f.area === "staged").length;
  const conflicts = files.filter((f) => f.area === "conflicted");

  // Keep selection valid when status changes; pick the first file when nothing is selected.
  useEffect(() => {
    if (focusKey && files.some((f) => keyOf(f) === focusKey)) {
      setSelected((s) => new Set([...s].filter((k) => files.some((f) => keyOf(f) === k))));
      return;
    }
    const prevPath = focusKey?.split(":").slice(1).join(":");
    const same = files.find((f) => f.path === prevPath) ?? shown[0] ?? null;
    setFocusKey(same ? keyOf(same) : null);
    setSelected(same ? new Set([keyOf(same)]) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Load the diff for the focused file. Read-only.
  useEffect(() => {
    if (id == null || !focused) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    api
      .diffFile(id, focused.path, focused.area, focused.origPath)
      .then((d) => {
        if (!cancelled) {
          setDiff(d);
          setDiffError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(toAppError(e));
        }
      })
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, focused, revision]);

  if (!activeRepo || id == null) return null;
  if (statusError) return <div className="p-4"><ErrorNotice error={statusError} /></div>;

  const actions: FileListActions = {
    stage: (fs) => void run("Stage", () => api.stagePaths(id, fs.map((f) => f.path))),
    unstage: (fs) =>
      void run("Unstage", () => api.unstagePaths(id, [...new Set(fs.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path])))])),
    discard: (fs) => setDiscard(fs),
    stageAll: () => {
      if (conflicts.length) {
        // Never mark conflicts resolved implicitly.
        const paths = [...new Set(files.filter((f) => f.area === "unstaged" || f.area === "untracked").map((f) => f.path))];
        if (paths.length) void run("Stage", () => api.stagePaths(id, paths));
        notify({ tone: "info", title: "Conflicted files weren't staged. Resolve them, then mark each one resolved." });
      } else void run("Stage all", () => api.stageAll(id));
    },
    unstageAll: () => void run("Unstage all", () => api.unstageAll(id)),
    copyPath: (p) => void writeText(p).then(() => notify({ tone: "success", title: "Path copied" })),
    showHistory: (p) => {
      setHistoryPath(p);
      setSection("history");
    },
  };

  const discardTracked = discard?.filter((f) => f.area === "unstaged") ?? [];
  const discardUntracked = discard?.filter((f) => f.area === "untracked") ?? [];

  const lineAction =
    focused?.area === "unstaged" || focused?.area === "staged"
      ? {
          label: (n: number) => `${focused.area === "staged" ? "Unstage" : "Stage"} ${n} ${n === 1 ? "line" : "lines"}`,
          icon: focused.area === "staged" ? unstageHunkIcon : stageHunkIcon,
          run: (h: { header: string }, lines: number[]) =>
            void run(focused.area === "staged" ? "Unstage lines" : "Stage lines", () => api.linesApply(id, focused.path, h.header, lines, focused.area === "staged")),
        }
      : undefined;

  const hunkAction =
    focused?.area === "unstaged"
      ? { label: "Stage hunk", icon: stageHunkIcon, run: (h: { header: string }) => void run("Stage hunk", () => api.hunkApply(id, focused.path, h.header, false)) }
      : focused?.area === "staged"
        ? { label: "Unstage hunk", icon: unstageHunkIcon, run: (h: { header: string }) => void run("Unstage hunk", () => api.hunkApply(id, focused.path, h.header, true)) }
        : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {status && <OperationBanner status={status} />}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 shrink-0 flex-col bg-surface" style={{ width }}>
          {files.length > 0 && (
            <div className="shrink-0 px-2 pb-1 pt-2">
              <SearchField label="Filter changed files" placeholder="Filter files" value={filter} onChange={setFilter} />
            </div>
          )}
          {files.length === 0 ? (
            <EmptyState icon={<CircleCheck size={22} />} title="No changes">
              Your working tree matches the last commit.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="No matching files">Nothing matches “{filter}”.</EmptyState>
          ) : (
            <FileList
              files={shown}
              selected={selected}
              focusKey={focusKey}
              onSelect={(s, f) => {
                setSelected(s);
                setFocusKey(f);
              }}
              actions={actions}
              disabled={!!busy}
            />
          )}
          <CommitComposer stagedCount={stagedCount} />
        </div>
        <Splitter width={width} onChange={setWidth} label="Resize file list" />
        <div className="min-w-0 flex-1 bg-surface">
          <DiffViewer
            diff={diff}
            loading={diffLoading}
            error={diffError}
            mode={settings?.diffMode ?? "unified"}
            onModeChange={(m) => void saveSettings({ diffMode: m })}
            highlight={settings?.syntaxHighlighting ?? true}
            hunkAction={hunkAction}
            lineAction={lineAction}
            busy={!!busy}
            emptyTitle={files.length ? "Select a file to see its changes" : "Working tree clean"}
            emptyBody={files.length ? undefined : "Edit files in your editor and they'll appear here."}
          />
        </div>
      </div>

      <ConfirmDialog
        open={discard !== null}
        onClose={() => setDiscard(null)}
        danger
        title={discardUntracked.length && !discardTracked.length ? `Move ${plural(discardUntracked.length, "new file")} to the trash?` : `Discard changes to ${plural(discard?.length ?? 0, "file")}?`}
        confirmLabel={discardUntracked.length && !discardTracked.length ? "Move to trash" : "Discard changes"}
        onConfirm={async () => {
          const res = await run(
            "Discard",
            async () => {
              let backup: string | null = null;
              if (discardTracked.length) backup = (await api.discardTracked(id, discardTracked.map((f) => f.path))).backupDir;
              if (discardUntracked.length) await api.discardUntracked(id, discardUntracked.map((f) => f.path));
              return backup;
            },
            { rethrow: true },
          );
          notify({
            tone: "success",
            title: "Changes discarded",
            body: res ? `A copy of the previous contents was saved to ${res}` : discardUntracked.length ? "New files were moved to the trash." : undefined,
          });
        }}
      >
        {discardTracked.length > 0 && (
          <p>
            Unstaged edits to {plural(discardTracked.length, "file")} will be replaced with the staged or last committed version. GitPilot
            saves a copy of the current contents first{info?.dataDir ? " in its data folder" : ""}, so you can recover them.
          </p>
        )}
        {discardUntracked.length > 0 && <p className="mt-2">{plural(discardUntracked.length, "new (untracked) file")} will be moved to the system trash.</p>}
        <ul className="selectable mt-2 max-h-36 overflow-y-auto rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text">
          {discard?.map((f) => <li key={keyOf(f)} className="truncate">{f.path}</li>)}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
