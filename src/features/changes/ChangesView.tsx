import { useEffect, useMemo, useState } from "react";
import { CircleCheck, EyeOff, Sparkles, Undo2 } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "@/bindings/AppError";
import type { FileDiff } from "@/bindings/FileDiff";
import type { FileEntry } from "@/bindings/FileEntry";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Splitter, usePanelWidth } from "@/components/ui/Splitter";
import { DiffViewer, stageHunkIcon, unstageHunkIcon } from "@/features/diff/DiffViewer";
import { IconButton } from "@/components/ui/IconButton";
import { ExplainDialog, type ExplainRequest } from "@/features/assistant/ExplainDialog";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";
import { CommitComposer } from "./CommitComposer";
import { FileList, keyOf, type FileListActions } from "./FileList";
import { IgnoreDialog } from "./IgnoreDialog";
import { BlameView } from "@/features/history/BlameView";
import { ConflictHelpDialog } from "./ConflictHelpDialog";
import { LfsMissingNotice } from "./LfsMissingNotice";
import { OperationBanner } from "./OperationBanner";
import { useExternalTools } from "@/features/tools/useExternalTools";

export function ChangesView() {
  const { activeRepo, status, statusError, settings, saveSettings, run, busy, notify, revision, setSection, setHistoryPath, info } = useStore();
  const tools = useExternalTools();
  const id = activeRepo?.id;
  const [width, setWidth] = usePanelWidth("changes", 340, 260, 620);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<AppError | null>(null);
  const [discard, setDiscard] = useState<FileEntry[] | null>(null);
  const [ignoreFiles, setIgnoreFiles] = useState<FileEntry[] | null>(null);
  const [untrackOpen, setUntrackOpen] = useState(false);
  const [partial, setPartial] = useState<{ path: string; header: string; lines: number[] | null } | null>(null);
  const [stashFiles, setStashFiles] = useState<FileEntry[] | null>(null);
  const [blame, setBlame] = useState<{ path: string; rev: string | null } | null>(null);
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const [conflictHelp, setConflictHelp] = useState<string | null>(null);

  const files = useMemo(() => status?.files ?? [], [status]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const focused = useMemo(() => files.find((f) => keyOf(f) === focusKey) ?? null, [files, focusKey]);
  const stagedCount = files.filter((f) => f.area === "staged").length;
  const conflicts = files.filter((f) => f.area === "conflicted");
  const ignoredTracked = useMemo(() => [...new Set(files.filter((f) => f.ignored).map((f) => f.path))], [files]);

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
    ignore: (fs) => setIgnoreFiles(fs),
    stash: (fs) => setStashFiles(fs),
    blame: (p) => setBlame({ path: p, rev: null }),
    openInEditor: (p) => tools.editor(p),
    updateSubmodules: (paths) => void run("Update submodule", () => api.submoduleUpdate(id, paths), { success: "Submodule updated" }),
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

  const discardHunk =
    focused?.area === "unstaged"
      ? { label: "Discard hunk", icon: <Undo2 size={13} />, run: (h: { header: string }) => setPartial({ path: focused.path, header: h.header, lines: null }) }
      : undefined;
  const discardLines =
    focused?.area === "unstaged"
      ? {
          label: (n: number) => `Discard ${n} ${n === 1 ? "line" : "lines"}`,
          icon: <Undo2 size={13} />,
          run: (h: { header: string }, lines: number[]) => setPartial({ path: focused.path, header: h.header, lines }),
        }
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {status && <OperationBanner status={status} />}
      {id != null && <LfsMissingNotice repoId={id} />}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 shrink-0 flex-col bg-surface" style={{ width }}>
          {files.length > 0 && (
            <div className="shrink-0 px-2 pb-1 pt-2">
              <SearchField label="Filter changed files" placeholder="Filter files" value={filter} onChange={setFilter} />
            </div>
          )}
          {ignoredTracked.length > 0 && (
            <div className="mx-2 mb-1 flex items-start gap-2 rounded border border-warning/30 bg-warning-bg px-2 py-1.5 text-sm" role="status">
              <EyeOff size={13} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {plural(ignoredTracked.length, "file")} {ignoredTracked.length === 1 ? "is" : "are"} in .gitignore but still tracked
                </p>
                <p className="text-muted">{ignoredTracked.length === 1 ? "It was" : "They were"} committed before the rule was added, so Git keeps showing changes.</p>
                <Button size="sm" className="mt-1.5" disabled={!!busy} onClick={() => setUntrackOpen(true)}>
                  Stop tracking…
                </Button>
              </div>
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
            discardHunk={discardHunk}
            discardLines={discardLines}
            conflict={
              focused?.area === "conflicted" && diff?.conflictView
                ? {
                    resolveBlock: (index, choice) => void run("Resolve conflict", () => api.conflictResolveBlock(id, focused.path, index, choice)),
                    takeSide: (current) => void run(current ? "Use current version" : "Use incoming version", () => api.conflictTakeSide(id, focused.path, current)),
                    markResolved: () => void run("Mark resolved", () => api.stagePaths(id, [focused.path]), { success: `${focused.path} marked as resolved` }),
                    help: diff.binary ? undefined : () => setConflictHelp(focused.path),
                    mergeTool: () => void run("Merge tool", () => api.conflictMergetool(id, focused.path), { success: `${focused.path} resolved and staged` }),
                  }
                : undefined
            }
            busy={!!busy}
            actions={
              focused && focused.area !== "conflicted" && diff && !diff.binary && diff.hunks.length > 0 ? (
                <IconButton
                  size="sm"
                  label="Explain these changes with AI"
                  icon={<Sparkles size={13} />}
                  onClick={() =>
                    setExplain({
                      title: `Explain changes to ${focused.path}`,
                      load: () => api.aiExplain(id, { kind: "change", path: focused.path, area: focused.area, origPath: focused.origPath }),
                    })
                  }
                />
              ) : undefined
            }
            emptyTitle={files.length ? "Select a file to see its changes" : "Working tree clean"}
            emptyBody={files.length ? undefined : "Edit files in your editor and they'll appear here."}
          />
        </div>
      </div>

      <IgnoreDialog files={ignoreFiles} onClose={() => setIgnoreFiles(null)} />
      <StashFilesDialog files={stashFiles} onClose={() => setStashFiles(null)} />
      <BlameView target={blame} onClose={() => setBlame(null)} />
      <ExplainDialog request={explain} onClose={() => setExplain(null)} />
      <ConflictHelpDialog path={conflictHelp} onClose={() => setConflictHelp(null)} />

      <ConfirmDialog
        open={partial !== null}
        onClose={() => setPartial(null)}
        danger
        title={partial?.lines ? `Discard ${plural(partial.lines.length, "selected line")}?` : "Discard this hunk?"}
        confirmLabel="Discard"
        onConfirm={async () => {
          if (!partial) return;
          const backup = await run("Discard", () => api.discardPartial(id, partial.path, partial.header, partial.lines), { rethrow: true });
          notify({ tone: "success", title: "Changes discarded", body: backup ? `A copy of the file was saved to ${backup}` : undefined });
        }}
      >
        <p>
          {partial?.lines ? "The selected changes" : "This part of your changes"} in <span className="font-mono text-sm">{partial?.path}</span> will be reverted to the last staged or committed version. The rest of the file is kept, and GitPilot saves a copy of the current file first.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={untrackOpen}
        onClose={() => setUntrackOpen(false)}
        title={`Stop tracking ${plural(ignoredTracked.length, "file")}?`}
        confirmLabel="Stop tracking"
        onConfirm={async () => {
          await run("Stop tracking", () => api.untrackPaths(id, ignoredTracked), { rethrow: true });
          notify({ tone: "success", title: `Stopped tracking ${plural(ignoredTracked.length, "file")}`, body: "The removal is staged. Commit to finish; the files stay on your computer." });
        }}
      >
        <p>
          The files stay on your computer, and .gitignore keeps them out from now on. After you commit and push, they're removed from the repository, and from other people's copies when they pull.
        </p>
        <ul className="selectable mt-2 max-h-36 overflow-y-auto rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text">
          {ignoredTracked.map((p) => <li key={p} className="truncate">{p}</li>)}
        </ul>
      </ConfirmDialog>

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

function StashFilesDialog({ files, onClose }: { files: FileEntry[] | null; onClose: () => void }) {
  const { activeRepo, run, notify } = useStore();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const paths = [...new Set((files ?? []).map((f) => f.path))];
  const hasUntracked = (files ?? []).some((f) => f.area === "untracked");
  useEffect(() => {
    if (files) {
      setMessage("");
    }
  }, [files]);
  const save = async () => {
    if (!activeRepo || paths.length === 0) return;
    setBusy(true);
    const ok = await run("Stash", () => api.stashPaths(activeRepo.id, message, hasUntracked, paths));
    setBusy(false);
    if (ok !== undefined) {
      notify({ tone: "success", title: `Stashed ${plural(paths.length, "file")}`, body: "Find it under Branches → Stashes to bring it back." });
      onClose();
    }
  };
  return (
    <Dialog
      open={files !== null}
      onClose={onClose}
      busy={busy}
      title={`Stash ${plural(paths.length, "file")}`}
      description="Puts these changes aside and restores the files to their last committed state. Other files aren't touched."
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Stash</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="Stash name" autoFocus placeholder="Name (optional), e.g. half-done login form" value={message} onChange={(e) => setMessage(e.target.value)} />
        <ul className="selectable max-h-32 overflow-y-auto rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs">
          {paths.map((p) => <li key={p} className="truncate">{p}</li>)}
        </ul>
        {hasUntracked && <p className="text-sm text-muted">New files are included and will be removed from the folder until you apply the stash.</p>}
      </div>
    </Dialog>
  );
}
