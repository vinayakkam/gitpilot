import { useCallback, useEffect, useMemo, useRef, useState } from "react";
<<<<<<< HEAD
import { Copy, FileClock, GitCommitHorizontal, GitMerge, Undo2, X } from "lucide-react";
=======
import { Copy, FileClock, GitCommitHorizontal, GitMerge, X } from "lucide-react";
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "@/bindings/AppError";
import type { CommitDetail } from "@/bindings/CommitDetail";
import type { CommitFile } from "@/bindings/CommitFile";
import type { CommitSummary } from "@/bindings/CommitSummary";
import type { FileDiff } from "@/bindings/FileDiff";
import { Button } from "@/components/ui/Button";
<<<<<<< HEAD
import { ConfirmDialog } from "@/components/ui/Dialog";
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";
import { Splitter, usePanelWidth } from "@/components/ui/Splitter";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { absoluteTime, plural, relativeTime, splitPath } from "@/lib/format";
import { useDebounced } from "@/lib/useAsync";
<<<<<<< HEAD
import { useIntegrate } from "@/lib/useIntegrate";
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
import { useStore } from "@/store/AppStore";

const PAGE = 100;

function CommitRow({ c, active, onClick, onContext }: { c: CommitSummary; active: boolean; onClick: () => void; onContext: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="option"
      aria-selected={active}
      id={`commit-${c.hash}`}
      onClick={onClick}
      onContextMenu={onContext}
      className={cx("mx-1 flex flex-col justify-center gap-0.5 rounded px-2.5 py-1.5", active ? "bg-selection" : "hover:bg-surface-2")}
    >
      <div className="flex min-w-0 items-center gap-2">
        {c.parents.length > 1 && <GitMerge size={12} className="shrink-0 text-faint" aria-label="Merge commit" />}
        <span className="truncate text-base">{c.subject || <span className="italic text-faint">(no message)</span>}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-faint">
        <span className="font-mono">{c.shortHash}</span>
        <span className="truncate">{c.authorName}</span>
        <span className="shrink-0" title={absoluteTime(c.authorTime)}>{relativeTime(c.authorTime)}</span>
        <span className="flex min-w-0 flex-1 justify-end gap-1 overflow-hidden">
          {c.refs.slice(0, 3).map((r) => (
            <span key={r} className={cx("truncate rounded-sm px-1 font-mono text-[10px]", r.startsWith("tag: ") ? "bg-warning-bg text-warning" : "bg-accent-soft text-accent-text")}>
              {r.replace(/^tag: /, "")}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function Person({ label, name, email, time }: { label: string; name: string; email: string; time: number }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-[72px] shrink-0 text-muted">{label}</span>
      <span className="selectable truncate">
        {name} <span className="text-faint">&lt;{email}&gt;</span>
      </span>
      <span className="shrink-0 text-faint" title={absoluteTime(time)}>{relativeTime(time)}</span>
    </div>
  );
}

export function HistoryView() {
  const { activeRepo, revision, settings, saveSettings, notify, historyPath, setHistoryPath, historyJump, setHistoryJump, status } = useStore();
  const id = activeRepo?.id;
  const [listW, setListW] = usePanelWidth("history", 380, 280, 640);
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 250);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailErr, setDetailErr] = useState<AppError | null>(null);
  const [file, setFile] = useState<CommitFile | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffErr, setDiffErr] = useState<AppError | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
<<<<<<< HEAD
  const [revert, setRevert] = useState<CommitSummary | null>(null);
  const integrate = useIntegrate();
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  const seq = useRef(0);

  useEffect(() => {
    if (historyJump) {
      setQuery(historyJump);
      setHistoryJump(null);
    }
  }, [historyJump, setHistoryJump]);
  const headOid = status?.branch.oid;

  const load = useCallback(
    async (skip: number) => {
      if (id == null) return;
      const s = ++seq.current;
      setLoading(true);
      try {
        const page = await api.log(id, { rev: null, skip, limit: PAGE, search: q.trim() || null, path: historyPath });
        if (s !== seq.current) return;
        setCommits((prev) => (skip === 0 ? page.commits : [...prev, ...page.commits]));
        setHasMore(page.hasMore);
        setError(null);
      } catch (e) {
        if (s === seq.current) setError(toAppError(e));
      } finally {
        if (s === seq.current) setLoading(false);
      }
    },
    [id, q, historyPath],
  );

  // Reload when the query/filter changes, after operations, or when HEAD moves.
  useEffect(() => {
    void load(0);
  }, [load, revision, headOid]);

  useEffect(() => {
    if (!sel && commits[0]) setSel(commits[0].hash);
  }, [commits, sel]);
  useEffect(() => {
    setSel(null);
  }, [id, q, historyPath]);

  useEffect(() => {
    if (id == null || !sel) {
      setDetail(null);
      return;
    }
    let c = false;
    setDetailErr(null);
    api.commitGet(id, sel).then(
      (d) => {
        if (c) return;
        setDetail(d);
        const keep = historyPath ? d.files.find((f) => f.path === historyPath || f.origPath === historyPath) : null;
        setFile(keep ?? d.files[0] ?? null);
      },
      (e) => !c && setDetailErr(toAppError(e)),
    );
    return () => {
      c = true;
    };
  }, [id, sel, historyPath]);

  useEffect(() => {
    if (id == null || !sel || !file) {
      setDiff(null);
      return;
    }
    let c = false;
    setDiffLoading(true);
    setDiffErr(null);
    api
      .commitDiffFile(id, sel, file.path, file.origPath)
      .then((d) => !c && setDiff(d), (e) => !c && setDiffErr(toAppError(e)))
      .finally(() => !c && setDiffLoading(false));
    return () => {
      c = true;
    };
  }, [id, sel, file]);

  const copy = (text: string, what: string) => void writeText(text).then(() => notify({ tone: "success", title: `${what} copied` }));

  const index = useMemo(() => commits.findIndex((c) => c.hash === sel), [commits, sel]);
  const move = (d: number) => {
    const c = commits[index + d];
    if (c) {
      setSel(c.hash);
      document.getElementById(`commit-${c.hash}`)?.scrollIntoView({ block: "nearest" });
    }
    if (index + d >= commits.length - 5 && hasMore && !loading) void load(commits.length);
  };

  if (!activeRepo) return null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex shrink-0 flex-col bg-surface" style={{ width: listW }}>
        <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-1.5 pt-2">
          <SearchField label="Search commits" placeholder="Search messages, author:name, or a hash" value={query} onChange={setQuery} />
          {historyPath && (
            <div className="flex items-center gap-1.5 rounded bg-accent-soft py-0.5 pl-2 pr-0.5 text-sm text-accent-text">
              <FileClock size={13} className="shrink-0" />
              <span className="flex-1 truncate font-mono text-xs" title={historyPath}>{historyPath}</span>
              <IconButton size="sm" label="Show all commits" icon={<X size={13} />} onClick={() => setHistoryPath(null)} />
            </div>
          )}
        </div>
        <div
          role="listbox"
          aria-label="Commits"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (hasMore && !loading && el.scrollTop + el.clientHeight > el.scrollHeight - 200) void load(commits.length);
          }}
          className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
        >
          {error && <ErrorNotice className="m-2" error={error} />}
          {!error && commits.length === 0 && !loading && (
            <EmptyState icon={<GitCommitHorizontal size={22} />} title={q || historyPath ? "No matching commits" : "No commits yet"}>
              {q ? `Nothing matches “${q}”.` : historyPath ? "This file has no committed history." : "Commits you make will be listed here."}
            </EmptyState>
          )}
          {commits.map((c) => (
            <CommitRow
              key={c.hash}
              c={c}
              active={c.hash === sel}
              onClick={() => setSel(c.hash)}
              onContext={(e) => {
                e.preventDefault();
                setMenu({
                  at: { x: e.clientX, y: e.clientY },
                  items: [
                    { label: "Copy commit hash", icon: <Copy size={14} />, onSelect: () => copy(c.hash, "Hash") },
                    { label: "Copy message", icon: <Copy size={14} />, onSelect: () => copy(c.subject, "Message") },
<<<<<<< HEAD
                    { type: "separator" },
                    { label: "Revert this commit…", icon: <Undo2 size={14} />, disabled: status?.state !== "normal", onSelect: () => setRevert(c) },
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                  ],
                });
              }}
            />
          ))}
          {loading && <div className="flex justify-center py-3"><Spinner label="Loading commits" /></div>}
          {hasMore && !loading && (
            <div className="flex justify-center py-2">
              <Button size="sm" variant="ghost" onClick={() => void load(commits.length)}>Load more</Button>
            </div>
          )}
        </div>
      </div>
      <Splitter width={listW} onChange={setListW} label="Resize commit list" />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {detailErr ? (
          <div className="p-4"><ErrorNotice error={detailErr} /></div>
        ) : !detail ? (
          <EmptyState title={commits.length ? "Select a commit" : ""} />
        ) : (
          <>
            <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border px-4 py-3">
              <div className="flex items-start gap-3">
                <h2 className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words text-md font-semibold">{detail.message.split("\n")[0]}</h2>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" icon={<Copy size={12} />} onClick={() => copy(detail.summary.hash, "Hash")}>
                    <span className="font-mono">{detail.summary.shortHash}</span>
                  </Button>
                  <IconButton size="sm" label="Copy full message" icon={<Copy size={13} />} onClick={() => copy(detail.message, "Message")} />
<<<<<<< HEAD
                  <IconButton size="sm" label="Revert this commit…" icon={<Undo2 size={13} />} disabled={status?.state !== "normal"} onClick={() => setRevert(detail.summary)} />
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                </div>
              </div>
              {detail.message.includes("\n") && (
                <pre className="selectable mt-2 whitespace-pre-wrap font-sans text-base text-muted">{detail.message.split("\n").slice(1).join("\n").trim()}</pre>
              )}
              <div className="mt-3 flex flex-col gap-0.5 text-sm">
                <Person label="Author" name={detail.summary.authorName} email={detail.summary.authorEmail} time={detail.summary.authorTime} />
                {(detail.summary.committerName !== detail.summary.authorName ||
                  detail.summary.committerEmail !== detail.summary.authorEmail ||
                  detail.summary.commitTime !== detail.summary.authorTime) && (
                  <Person label="Committer" name={detail.summary.committerName} email={detail.summary.committerEmail} time={detail.summary.commitTime} />
                )}
                <div className="flex items-baseline gap-2">
                  <span className="w-[72px] shrink-0 text-muted">{detail.summary.parents.length > 1 ? "Parents" : "Parent"}</span>
                  {detail.summary.parents.length === 0 ? (
                    <span className="text-faint">None (first commit)</span>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {detail.summary.parents.map((p) => (
                        <button key={p} type="button" onClick={() => setSel(p)} className="font-mono text-xs text-accent-text hover:underline">
                          {p.slice(0, 10)}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                {detail.comparedToFirstParent && <p className="mt-1 text-xs text-faint">Merge commit: changes are shown against the first parent.</p>}
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="w-[260px] shrink-0 overflow-y-auto border-r border-border py-1" role="listbox" aria-label="Files in this commit">
                <p className="px-3 pb-1 pt-1 text-xs text-faint">{plural(detail.files.length, "file")} changed</p>
                {detail.files.map((f) => {
                  const { name, dir } = splitPath(f.path);
                  return (
                    <div
                      key={f.path}
                      role="option"
                      aria-selected={file?.path === f.path}
                      onClick={() => setFile(f)}
                      title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                      className={cx("mx-1 flex items-center gap-2 rounded px-2", file?.path === f.path ? "bg-selection" : "hover:bg-surface-2")}
                      style={{ height: "var(--row-h)" }}
                    >
                      <StatusGlyph change={f.change} />
                      <span className="min-w-0 flex-1 truncate">
                        {name}
                        {dir && <span className="ml-1.5 text-sm text-faint">{dir}</span>}
                      </span>
                      {f.binary ? (
                        <Badge>bin</Badge>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums">
                          <span className="text-added">+{f.additions ?? 0}</span> <span className="text-removed">−{f.deletions ?? 0}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="min-w-0 flex-1">
                <DiffViewer
                  diff={diff}
                  loading={diffLoading}
                  error={diffErr}
                  mode={settings?.diffMode ?? "unified"}
                  onModeChange={(m) => void saveSettings({ diffMode: m })}
                  highlight={settings?.syntaxHighlighting ?? true}
                  emptyTitle={detail.files.length ? "Select a file" : "This commit has no file changes"}
                />
              </div>
            </div>
          </>
        )}
      </div>
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
<<<<<<< HEAD
      <ConfirmDialog
        open={revert !== null}
        onClose={() => setRevert(null)}
        title={`Revert “${revert?.subject ?? ""}”?`}
        confirmLabel="Revert commit"
        onConfirm={async () => {
          if (revert && activeRepo) await integrate("Revert", () => api.commitRevert(activeRepo.id, revert.hash), `Reverted ${revert.shortHash}`);
        }}
      >
        <p>
          Git creates a new commit that undoes the changes from <span className="font-mono">{revert?.shortHash}</span>. History isn't rewritten, so
          this is safe even if the commit was already pushed.
        </p>
        {revert && revert.parents.length > 1 && <p className="mt-2">This is a merge commit: its changes are undone relative to its first parent.</p>}
        <p className="mt-2">If later commits changed the same lines, Git stops so you can resolve the conflicts.</p>
      </ConfirmDialog>
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
    </div>
  );
}
