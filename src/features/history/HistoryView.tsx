import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code, Copy, FileClock, GitCommitHorizontal, GitCompare, GitFork, GitMerge, History, LifeBuoy, ListOrdered, RotateCcw, ScanSearch, SlidersHorizontal, Sparkles, Tag as TagIcon, Undo2, X } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "@/bindings/AppError";
import type { CommitDetail } from "@/bindings/CommitDetail";
import type { CommitFile } from "@/bindings/CommitFile";
import type { CommitSummary } from "@/bindings/CommitSummary";
import type { FileDiff } from "@/bindings/FileDiff";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";
import { Splitter, usePanelWidth } from "@/components/ui/Splitter";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { TagDialog } from "@/features/branches/TagDialog";
import { focusRecoverSection } from "@/features/branches/RecoverSection";
import { useExternalTools } from "@/features/tools/useExternalTools";
import { CompareFilesDialog, type CompareTarget } from "@/features/compare/CompareFilesDialog";
import { ExplainDialog, type ExplainRequest } from "@/features/assistant/ExplainDialog";
import { BlameView } from "./BlameView";
import { SignatureBadge } from "./SignatureBadge";
import { EditCommitsDialog } from "./EditCommitsDialog";
import { ResetDialog } from "./ResetDialog";
import { undoLastCommit } from "@/features/changes/CommitComposer";
import type { LastCommit } from "@/bindings/LastCommit";
import { api } from "@/lib/api";
import { layoutGraph, type GraphRow } from "@/lib/graph";
import { toAppError } from "@/lib/errors";
import { absoluteTime, plural, relativeTime, splitPath } from "@/lib/format";
import { useDebounced } from "@/lib/useAsync";
import { useIntegrate } from "@/lib/useIntegrate";
import { useStore } from "@/store/AppStore";

const PAGE = 100;

const LANE_W = 12;
const ROW_H = 46;
const MAX_LANES = 10;
const GRAPH_COLORS = ["var(--accent)", "var(--added)", "var(--modified)", "var(--renamed)", "var(--conflict)", "var(--removed)", "var(--text-muted)"];
const laneColor = (i: number) => GRAPH_COLORS[i % GRAPH_COLORS.length]!;
const lx = (col: number) => Math.min(col, MAX_LANES - 1) * LANE_W + LANE_W / 2 + 2;

/** The lines and dot for one row of the commit graph. */
function GraphCell({ row, lanes, merge }: { row: GraphRow; lanes: number; merge: boolean }) {
  const mid = ROW_H / 2;
  const w = Math.min(lanes, MAX_LANES) * LANE_W + 4;
  return (
    <svg width={w} height={ROW_H} className="shrink-0" aria-hidden>
      {row.top.map(([from, to, color], i) => (
        <path key={`t${i}`} d={from === to ? `M${lx(from)} 0V${mid}` : `M${lx(from)} 0C${lx(from)} ${mid * 0.6} ${lx(to)} ${mid * 0.4} ${lx(to)} ${mid}`} stroke={laneColor(color)} strokeWidth={1.75} fill="none" />
      ))}
      {row.bottom.map(([from, to, color], i) => (
        <path key={`b${i}`} d={from === to ? `M${lx(from)} ${mid}V${ROW_H}` : `M${lx(from)} ${mid}C${lx(from)} ${mid + mid * 0.6} ${lx(to)} ${mid + mid * 0.4} ${lx(to)} ${ROW_H}`} stroke={laneColor(color)} strokeWidth={1.75} fill="none" />
      ))}
      <circle cx={lx(row.col)} cy={mid} r={merge ? 3 : 4} fill={merge ? "var(--surface)" : laneColor(row.color)} stroke={laneColor(row.color)} strokeWidth={merge ? 2 : 0} />
    </svg>
  );
}

function CommitRow({ c, active, onClick, onContext, graph, lanes }: { c: CommitSummary; active: boolean; onClick: () => void; onContext: (e: React.MouseEvent) => void; graph?: GraphRow; lanes: number }) {
  return (
    <div
      role="option"
      aria-selected={active}
      id={`commit-${c.hash}`}
      onClick={onClick}
      onContextMenu={onContext}
      className={cx("mx-1 flex items-center gap-1 rounded pr-2.5", graph ? "pl-0.5" : "pl-2.5", active ? "bg-selection" : "hover:bg-surface-2")}
      style={{ height: ROW_H }}
    >
      {graph && <GraphCell row={graph} lanes={lanes} merge={c.parents.length > 1} />}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
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

/** Matches diff lines against a content search the way git did (-S: the text, -G: a regex). */
export function contentMatcher(content: string, regex: boolean): ((line: string) => boolean) | undefined {
  if (!content) return undefined;
  if (!regex) return (line) => line.includes(content);
  try {
    const re = new RegExp(content);
    return (line) => re.test(line);
  } catch {
    return undefined;
  }
}

export function HistoryView() {
  const { activeRepo, revision, settings, saveSettings, notify, historyPath, setHistoryPath, historyJump, setHistoryJump, status, run, setSection } = useStore();
  const id = activeRepo?.id;
  const [listW, setListW] = usePanelWidth("history", 380, 280, 640);
  const tools = useExternalTools();
  const [query, setQuery] = useState("");
  const [showGraph, setShowGraph] = useState(() => {
    try {
      return localStorage.getItem("gitpilot.history.graph") !== "0";
    } catch {
      return true;
    }
  });
  const q = useDebounced(query, 250);
  const [advanced, setAdvanced] = useState(false);
  const [contentInput, setContentInput] = useState("");
  const content = useDebounced(advanced ? contentInput : "", 400);
  const [regex, setRegex] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const dates = advanced ? { since: since || null, until: until || null } : { since: null, until: null };
  const [folderInput, setFolderInput] = useState("");
  const folder = useDebounced(advanced ? folderInput.trim() : "", 400);
  // File history (from a file's menu) wins over the advanced search's file or folder.
  const path = historyPath ?? (folder || null);
  const filtered = !!(q.trim() || path || content || dates.since || dates.until);
  const match = useMemo(() => contentMatcher(content, regex), [content, regex]);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  // The graph only makes sense for the full, unfiltered history.
  const graph = useMemo(() => (showGraph && !filtered ? layoutGraph(commits) : null), [showGraph, filtered, commits]);
  const graphLanes = useMemo(() => (graph ? Math.max(1, ...graph.map((r) => r.width)) : 0), [graph]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const [detailErr, setDetailErr] = useState<AppError | null>(null);
  const [file, setFile] = useState<CommitFile | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffErr, setDiffErr] = useState<AppError | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [revert, setRevert] = useState<CommitSummary | null>(null);
  const [tagOn, setTagOn] = useState<{ hash: string; label: string } | null>(null);
  const [undo, setUndo] = useState<LastCommit | null>(null);
  const [compare, setCompare] = useState<CompareTarget | null>(null);
  const [blame, setBlame] = useState<{ path: string; rev: string | null } | null>(null);
  const [editFrom, setEditFrom] = useState<{ base: string | null; from: string } | null>(null);
  const [resetTo, setResetTo] = useState<{ hash: string; label: string } | null>(null);
  const integrate = useIntegrate();
  const openUndo = async () => {
    if (!activeRepo) return;
    const last = await api.lastCommit(activeRepo.id).catch(() => null);
    if (!last) return;
    if (last.isMerge) {
      notify({ tone: "info", title: "The last commit is a merge", body: "Use Revert instead; undoing merges isn't supported." });
      return;
    }
    setUndo(last);
  };
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
        const page = await api.log(id, { rev: null, skip, limit: PAGE, search: q.trim() || null, path, content: content || null, regex, ...dates });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dates` is rebuilt every render; its parts are listed.
    [id, q, path, content, regex, dates.since, dates.until],
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
  }, [id, q, path, content, regex, dates.since, dates.until]);
  // When HEAD moves (commit, reset, edited commits), the selected commit may no longer be on
  // the branch: start again from the newest one.
  const lastHead = useRef(headOid);
  useEffect(() => {
    if (lastHead.current !== headOid) {
      lastHead.current = headOid;
      setSel(null);
    }
  }, [headOid]);

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
        const inside = path?.replace(/[\\/]+$/, "");
        const keep = inside ? d.files.find((f) => f.path === inside || f.origPath === inside || f.path.startsWith(`${inside}/`)) : null;
        setFile(keep ?? d.files[0] ?? null);
      },
      (e) => !c && setDetailErr(toAppError(e)),
    );
    return () => {
      c = true;
    };
  }, [id, sel, path]);

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
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SearchField label="Search commits" placeholder="Search messages, author:name, or a hash" value={query} onChange={setQuery} />
            </div>
            <IconButton
              label={advanced ? "Hide advanced search" : "Advanced search"}
              icon={<SlidersHorizontal size={14} />}
              className={advanced ? "text-accent-text" : undefined}
              aria-pressed={advanced}
              onClick={() => setAdvanced((v) => !v)}
            />
            <IconButton
              label={showGraph ? "Hide commit graph" : "Show commit graph"}
              icon={<GitFork size={14} />}
              className={showGraph ? "text-accent-text" : undefined}
              onClick={() =>
                setShowGraph((v) => {
                  try {
                    localStorage.setItem("gitpilot.history.graph", v ? "0" : "1");
                  } catch {
                    /* not persisted */
                  }
                  return !v;
                })
              }
            />
          </div>
          {advanced && (
            <div className="flex flex-col gap-1.5 rounded border border-border p-2" role="group" aria-label="Advanced search">
              <Input aria-label="Text in changes" placeholder="Text added or removed by the commit" className="font-mono" value={contentInput} onChange={(e) => setContentInput(e.target.value)} />
              <Input
                aria-label="File or folder"
                placeholder={historyPath ? "Showing one file's history" : "File or folder, e.g. src/ or README.md"}
                className="font-mono"
                disabled={!!historyPath}
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
              />
              <Checkbox checked={regex} onChange={setRegex} label="Regular expression (matches changed lines)" />
              <div className="flex items-center gap-1.5 text-sm text-muted">
                <label className="flex items-center gap-1.5">
                  From <Input type="date" aria-label="From date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} />
                </label>
                <label className="flex items-center gap-1.5">
                  to <Input type="date" aria-label="To date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} />
                </label>
              </div>
            </div>
          )}
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
            <EmptyState icon={<GitCommitHorizontal size={22} />} title={filtered ? "No matching commits" : "No commits yet"}>
              {q ? `Nothing matches “${q}”.` : content ? `No commit changes “${content}”.` : dates.since || dates.until ? "No commits in that date range." : historyPath ? "This file has no committed history." : folder ? `No commits changed “${folder}”.` : "Commits you make will be listed here."}
            </EmptyState>
          )}
          {commits.map((c, i) => (
            <CommitRow
              graph={graph?.[i]}
              lanes={graphLanes}
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
                    { type: "separator" },
                    { label: "Compare with current version…", icon: <GitCompare size={14} />, onSelect: () => setCompare({ base: c.hash, head: "HEAD" }) },
                    { label: "Create tag here…", icon: <TagIcon size={14} />, onSelect: () => setTagOn({ hash: c.hash, label: `${c.shortHash} · ${c.subject}` }) },
                    ...(c.hash === headOid
                      ? [{ label: "Undo this commit…", icon: <RotateCcw size={14} />, disabled: status?.state !== "normal", onSelect: () => void openUndo() } as MenuItem]
                      : []),
                    { label: "Revert this commit…", icon: <Undo2 size={14} />, disabled: status?.state !== "normal", onSelect: () => setRevert(c) },
                    { type: "separator" },
                    { label: "Edit commits from here…", icon: <ListOrdered size={14} />, disabled: status?.state !== "normal" || c.parents.length > 1, onSelect: () => setEditFrom({ base: c.parents[0] ?? null, from: c.hash }) },
                    ...(c.hash !== headOid ? [{ label: "Reset branch to here…", icon: <History size={14} />, disabled: status?.state !== "normal", onSelect: () => setResetTo({ hash: c.hash, label: `${c.shortHash} · ${c.subject}` }) } as MenuItem] : []),
                    { label: "Show earlier states…", icon: <LifeBuoy size={14} />, onSelect: () => { focusRecoverSection(); setSection("branches"); } },
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
                  {id != null && <SignatureBadge repoId={id} hash={detail.summary.hash} />}
                  <Button size="sm" icon={<Copy size={12} />} onClick={() => copy(detail.summary.hash, "Hash")}>
                    <span className="font-mono">{detail.summary.shortHash}</span>
                  </Button>
                  <IconButton size="sm" label="Copy full message" icon={<Copy size={13} />} onClick={() => copy(detail.message, "Message")} />
                  <IconButton
                    size="sm"
                    label="Explain this commit with AI"
                    icon={<Sparkles size={13} />}
                    disabled={id == null}
                    onClick={() => {
                      if (id == null) return;
                      const hash = detail.summary.hash;
                      setExplain({ title: `Explain commit ${detail.summary.shortHash}`, load: () => api.aiExplain(id, { kind: "commit", hash }) });
                    }}
                  />
                  <IconButton size="sm" label="Revert this commit…" icon={<Undo2 size={13} />} disabled={status?.state !== "normal"} onClick={() => setRevert(detail.summary)} />
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({
                          at: { x: e.clientX, y: e.clientY },
                          items: [
                            { label: "Blame (who changed each line)", icon: <ScanSearch size={14} />, disabled: f.change === "deleted" || f.binary, onSelect: () => setBlame({ path: f.path, rev: detail.summary.hash }) },
                            { label: "Show file history", icon: <FileClock size={14} />, onSelect: () => setHistoryPath(f.path) },
                            { label: "Open in editor", icon: <Code size={14} />, disabled: f.change === "deleted", onSelect: () => tools.editor(f.path) },
                            { label: "Copy path", icon: <Copy size={14} />, onSelect: () => copy(f.path, "Path") },
                          ],
                        });
                      }}
                      title={f.origPath ? `${f.origPath} → ${f.path}` : undefined}
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
                  match={match}
                  emptyTitle={detail.files.length ? "Select a file" : "This commit has no file changes"}
                />
              </div>
            </div>
          </>
        )}
      </div>
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      <TagDialog target={tagOn} onClose={() => setTagOn(null)} />
      <CompareFilesDialog target={compare} onClose={() => setCompare(null)} />
      <BlameView target={blame} onClose={() => setBlame(null)} />
      <ExplainDialog request={explain} onClose={() => setExplain(null)} />
      <EditCommitsDialog target={editFrom} onClose={() => setEditFrom(null)} />
      <ResetDialog target={resetTo} onClose={() => setResetTo(null)} />
      <ConfirmDialog
        open={undo !== null}
        onClose={() => setUndo(null)}
        danger={undo?.pushed}
        acknowledge={undo?.pushed ? "I understand this rewrites history that's already on the remote." : undefined}
        title="Undo the last commit?"
        confirmLabel="Undo commit"
        onConfirm={async () => {
          if (!undo || !activeRepo) return;
          const id = activeRepo.id;
          const m = await run("Undo commit", () => undoLastCommit(id, undo.pushed), { rethrow: true });
          if (m !== undefined) {
            notify({ tone: "success", title: "Commit undone", body: "Its changes are staged again and the message is in the commit box." });
            setSection("changes");
          }
        }}
      >
        <p>The commit is removed from the branch, but nothing is lost: its changes go back to the staging area and its message goes back into the commit box, ready to edit and commit again.</p>
        {undo?.pushed && <p className="mt-2">This commit is already on the remote, so you'd need to push with force (with lease) afterwards.</p>}
      </ConfirmDialog>
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
    </div>
  );
}
