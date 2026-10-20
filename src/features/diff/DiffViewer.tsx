import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, Columns2, FileWarning, Minus, Plus, Rows3 } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { DiffLine } from "@/bindings/DiffLine";
import type { DiffMode } from "@/bindings/DiffMode";
import type { FileDiff } from "@/bindings/FileDiff";
import type { Hunk } from "@/bindings/Hunk";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { highlightLine, languageFor } from "@/lib/highlight";

export interface HunkAction {
  label: string;
  icon: ReactNode;
  run: (hunk: Hunk) => void;
}

<<<<<<< HEAD
/** Stage/unstage individual lines: `lines` are indices into `hunk.lines`. */
export interface LineAction {
  label: (count: number) => string;
  icon: ReactNode;
  run: (hunk: Hunk, lines: number[]) => void;
}

type Selection = { hunk: number; lines: Set<number>; anchor: number } | null;

/** Everything a line row needs to be selectable. */
interface Pick {
  enabled: boolean;
  isSelected: (hi: number, li: number) => boolean;
  toggle: (hi: number, li: number, range: boolean) => void;
}

=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
interface Props {
  diff: FileDiff | null;
  loading?: boolean;
  error?: AppError | null;
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  highlight: boolean;
  hunkAction?: HunkAction;
<<<<<<< HEAD
  lineAction?: LineAction;
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  busy?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

<<<<<<< HEAD
type Ref = { line: DiffLine; li: number };
type Row =
  | { t: "hunk"; hunk: Hunk; hi: number; key: string }
  | { t: "line"; line: DiffLine; hi: number; li: number; key: string }
  | { t: "pair"; left: Ref | null; right: Ref | null; hi: number; key: string };
=======
type Row =
  | { t: "hunk"; hunk: Hunk; key: string }
  | { t: "line"; line: DiffLine; key: string }
  | { t: "pair"; left: DiffLine | null; right: DiffLine | null; key: string };
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854

const LINE_H = 20;
const HUNK_H = 30;

function buildRows(diff: FileDiff, mode: DiffMode): Row[] {
  const rows: Row[] = [];
  diff.hunks.forEach((h, hi) => {
<<<<<<< HEAD
    if (h.header) rows.push({ t: "hunk", hunk: h, hi, key: `h${hi}` });
    if (mode === "unified" || diff.conflictView) {
      h.lines.forEach((l, li) => rows.push({ t: "line", line: l, hi, li, key: `${hi}:${li}` }));
=======
    if (h.header) rows.push({ t: "hunk", hunk: h, key: `h${hi}` });
    if (mode === "unified" || diff.conflictView) {
      h.lines.forEach((l, li) => rows.push({ t: "line", line: l, key: `${hi}:${li}` }));
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
      return;
    }
    // Side-by-side: pair each run of deletions with the following run of additions.
    let i = 0;
    const L = h.lines;
    while (i < L.length) {
      const l = L[i]!;
      if (l.kind === "context" || l.kind === "noNewline") {
<<<<<<< HEAD
        rows.push({ t: "pair", left: { line: l, li: i }, right: { line: l, li: i }, hi, key: `${hi}:${i}` });
        i++;
        continue;
      }
      const dels: Ref[] = [];
      const adds: Ref[] = [];
      while (i < L.length && L[i]!.kind === "del") dels.push({ line: L[i]!, li: i++ });
      while (i < L.length && L[i]!.kind === "add") adds.push({ line: L[i]!, li: i++ });
=======
        rows.push({ t: "pair", left: l, right: l, key: `${hi}:${i}` });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < L.length && L[i]!.kind === "del") dels.push(L[i++]!);
      while (i < L.length && L[i]!.kind === "add") adds.push(L[i++]!);
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
      if (!dels.length && !adds.length) {
        i++;
        continue;
      }
      const n = Math.max(dels.length, adds.length);
<<<<<<< HEAD
      for (let k = 0; k < n; k++) rows.push({ t: "pair", left: dels[k] ?? null, right: adds[k] ?? null, hi, key: `${hi}:${i}:${k}` });
=======
      for (let k = 0; k < n; k++) rows.push({ t: "pair", left: dels[k] ?? null, right: adds[k] ?? null, key: `${hi}:${i}:${k}` });
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
    }
  });
  return rows;
}

const tone: Record<DiffLine["kind"], { row: string; gutter: string; sign: string }> = {
  context: { row: "", gutter: "text-faint", sign: " " },
  add: { row: "bg-added-bg", gutter: "bg-added-bg-strong/60 text-added", sign: "+" },
  del: { row: "bg-removed-bg", gutter: "bg-removed-bg-strong/60 text-removed", sign: "−" },
  noNewline: { row: "", gutter: "text-faint", sign: " " },
  marker: { row: "bg-surface-3 font-medium", gutter: "text-conflict", sign: "!" },
  ours: { row: "bg-accent-soft", gutter: "text-accent-text", sign: "<" },
  theirs: { row: "bg-conflict-bg", gutter: "text-conflict", sign: ">" },
};

const Code = memo(function Code({ text, lang }: { text: string; lang: string | null }) {
  const html = highlightLine(text, lang);
  if (html === null) return <>{text}</>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});

<<<<<<< HEAD
function LineCells({
  line,
  lang,
  showEol,
  side,
  hi = 0,
  li = 0,
  pick,
}: {
  line: DiffLine | null;
  lang: string | null;
  showEol: boolean;
  side?: "left" | "right";
  hi?: number;
  li?: number;
  pick?: Pick;
}) {
  if (!line) return <div className="min-h-5 flex-1 bg-surface-2/50" />;
  const t = tone[line.kind];
  const selectable = !!pick?.enabled && (line.kind === "add" || line.kind === "del");
  const selected = selectable && pick!.isSelected(hi, li);
  const lineNo = line.kind === "del" ? line.oldNo : line.newNo;
  const no = side === "left" ? line.oldNo : side === "right" ? line.newNo : null;
  return (
    <div className={cx("flex min-h-5 min-w-0 flex-1", t.row, selected && "shadow-[inset_3px_0_0_var(--accent)]")}>
=======
function LineCells({ line, lang, showEol, side }: { line: DiffLine | null; lang: string | null; showEol: boolean; side?: "left" | "right" }) {
  if (!line) return <div className="min-h-5 flex-1 bg-surface-2/50" />;
  const t = tone[line.kind];
  const no = side === "left" ? line.oldNo : side === "right" ? line.newNo : null;
  return (
    <div className={cx("flex min-h-5 min-w-0 flex-1", t.row)}>
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
      {side ? (
        <span className={cx("w-12 shrink-0 select-none pr-2 text-right", t.gutter)}>{no ?? ""}</span>
      ) : (
        <>
          <span className={cx("w-11 shrink-0 select-none pr-2 text-right", t.gutter)}>{line.oldNo ?? ""}</span>
          <span className={cx("w-11 shrink-0 select-none pr-2 text-right", t.gutter)}>{line.newNo ?? ""}</span>
        </>
      )}
<<<<<<< HEAD
      {selectable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`${line.kind === "add" ? "Added" : "Removed"} line ${lineNo ?? ""}: select for staging`}
          title="Select this line (Shift-click for a range)"
          onClick={(e) => pick!.toggle(hi, li, e.shiftKey)}
          className={cx(
            "mx-0.5 my-[2px] flex h-4 w-4 shrink-0 select-none items-center justify-center rounded-sm text-[11px] font-semibold leading-none",
            selected ? "bg-accent text-on-accent" : cx("hover:ring-1 hover:ring-current", t.gutter.replace(/bg-\S+/g, "")),
          )}
        >
          {t.sign}
        </button>
      ) : (
        <span className={cx("w-5 shrink-0 select-none text-center", t.gutter.replace(/bg-\S+/g, ""))} aria-hidden>
          {t.sign}
        </span>
      )}
=======
      <span className={cx("w-5 shrink-0 select-none text-center", t.gutter.replace(/bg-\S+/g, ""))} aria-hidden>
        {t.sign}
      </span>
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
      <span className={cx("selectable pr-4", side ? "min-w-0 flex-1 whitespace-pre-wrap break-all" : "whitespace-pre", line.kind === "noNewline" && "italic text-faint")}>
        {line.kind === "noNewline" ? "No newline at end of file" : <Code text={line.content} lang={lang} />}
        {showEol && line.crlf && (
          <span className="ml-1 select-none rounded-sm bg-surface-3 px-0.5 text-[10px] text-faint" title="Line ends with CRLF">
            CRLF
          </span>
        )}
      </span>
    </div>
  );
}

<<<<<<< HEAD
export function DiffViewer({ diff, loading, error, mode, onModeChange, highlight, hunkAction, lineAction, busy, emptyTitle, emptyBody }: Props) {
  const [sel, setSel] = useState<Selection>(null);
  // A new diff (after staging, or another file) invalidates line indices.
  useEffect(() => setSel(null), [diff]);
  const pick: Pick = {
    enabled: !!lineAction && !!diff?.hunkActions && !busy,
    isSelected: (hi, li) => sel?.hunk === hi && sel.lines.has(li),
    toggle: (hi, li, range) => {
      const lines = diff?.hunks[hi]?.lines ?? [];
      const changed = (i: number) => lines[i]?.kind === "add" || lines[i]?.kind === "del";
      setSel((cur) => {
        // Selections stay within one hunk: picking in another hunk starts over.
        if (!cur || cur.hunk !== hi) return { hunk: hi, lines: new Set([li]), anchor: li };
        const next = new Set(cur.lines);
        if (range) {
          const [a, b] = cur.anchor < li ? [cur.anchor, li] : [li, cur.anchor];
          for (let i = a; i <= b; i++) if (changed(i)) next.add(i);
        } else if (next.has(li)) next.delete(li);
        else next.add(li);
        return next.size ? { hunk: hi, lines: next, anchor: li } : null;
      });
    },
  };
=======
export function DiffViewer({ diff, loading, error, mode, onModeChange, highlight, hunkAction, busy, emptyTitle, emptyBody }: Props) {
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
  const scrollRef = useRef<HTMLDivElement>(null);
  const path = diff?.newPath ?? diff?.oldPath ?? null;
  const lang = highlight ? languageFor(path) : null;
  const effectiveMode: DiffMode = diff?.conflictView ? "unified" : mode;
  const rows = useMemo(() => (diff ? buildRows(diff, effectiveMode) : []), [diff, effectiveMode]);

  const { maxLen, mixedEol } = useMemo(() => {
    let m = 0;
    let crlf = 0;
    let lf = 0;
    for (const h of diff?.hunks ?? [])
      for (const l of h.lines) {
        const len = l.content.length + (l.content.match(/\t/g)?.length ?? 0) * 3;
        if (len > m) m = len;
        if (l.kind !== "noNewline") {
          if (l.crlf) crlf++;
          else lf++;
        }
      }
    return { maxLen: Math.min(m, 4000), mixedEol: crlf > 0 && lf > 0 };
  }, [diff]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.t === "hunk" ? HUNK_H : LINE_H),
    overscan: 24,
    // Side-by-side wraps long lines, so rows are measured; unified rows have a fixed height.
    measureElement: effectiveMode === "split" && !diff?.conflictView ? (el) => el.getBoundingClientRect().height : undefined,
  });
  const split = effectiveMode === "split";
  // Hunk headers stay pinned to the visible width while the code scrolls horizontally.
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, [diff]);
  // Measured heights from one layout must not leak into the other.
  useEffect(() => {
    virt.measure();
  }, [split, rows, virt]);

  if (error) return <div className="p-4"><ErrorNotice error={error} /></div>;
  if (!diff) {
    if (loading) return <div className="flex h-full items-center justify-center"><Spinner label="Loading diff" /></div>;
    return <EmptyState title={emptyTitle ?? "Select a file to see its changes"}>{emptyBody}</EmptyState>;
  }

  const renamed = diff.renamed && diff.oldPath && diff.newPath && diff.oldPath !== diff.newPath;
  const modeChanged = diff.oldMode && diff.newMode && diff.oldMode !== diff.newMode && !diff.newFile && !diff.deletedFile;
  const contentWidth = split ? "100%" : `calc(${maxLen}ch + 8.5rem)`;

  let body: ReactNode;
  if (diff.binary) {
    body = (
      <EmptyState icon={<FileWarning size={22} />} title="Binary file">
        {diff.newFile ? "A new binary file." : diff.deletedFile ? "A binary file was deleted." : "This binary file changed."} Its contents
        can't be shown as text.
      </EmptyState>
    );
  } else if (diff.conflictView && diff.deletedFile) {
    body = <EmptyState title="Deleted on one side">This file was deleted on one side of the merge and changed on the other. Stage it to keep it, or delete it and stage the deletion.</EmptyState>;
  } else if (rows.length === 0) {
    body = (
      <EmptyState title={diff.newFile ? "Empty file" : modeChanged ? "Only the file mode changed" : "No content changes"}>
        {modeChanged ? `${diff.oldMode} → ${diff.newMode}` : diff.newFile ? "This new file has no content." : null}
      </EmptyState>
    );
  } else {
    body = (
      <div ref={scrollRef} className={cx("hl relative min-h-0 flex-1 font-mono text-[12.5px] leading-5", split ? "overflow-y-auto overflow-x-hidden" : "overflow-auto")} style={{ tabSize: 4 }}>
        <div style={{ height: virt.getTotalSize(), minWidth: contentWidth, width: "100%", position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!;
            const style = split
              ? { position: "absolute" as const, top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }
              : { position: "absolute" as const, top: vi.start, left: 0, right: 0, height: vi.size };
            const measure = split ? { ref: virt.measureElement, "data-index": vi.index } : {};
            if (r.t === "hunk")
              return (
                <div
                  key={r.key}
                  style={split ? { ...style, height: HUNK_H } : style}
                  {...measure}
                  className="border-y border-border bg-surface-2 font-sans text-sm text-muted"
                >
                  <div className="sticky left-0 flex h-full items-center gap-3 pl-3 pr-2" style={{ width: viewportW || "100%" }}>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-faint">{r.hunk.header.match(/^@@[^@]*@@/)?.[0]}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.hunk.section}</span>
<<<<<<< HEAD
                    {lineAction && diff.hunkActions && sel?.hunk === r.hi ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSel(null)} className="shrink-0">
                          Clear
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          icon={lineAction.icon}
                          disabled={busy}
                          onClick={() => lineAction.run(r.hunk, [...sel.lines].sort((a, b) => a - b))}
                          className="shrink-0"
                        >
                          {lineAction.label(sel.lines.size)}
                        </Button>
                      </>
                    ) : (
                      hunkAction &&
                      diff.hunkActions && (
                        <Button size="sm" variant="ghost" icon={hunkAction.icon} disabled={busy} onClick={() => hunkAction.run(r.hunk)} className="shrink-0">
                          {hunkAction.label}
                        </Button>
                      )
=======
                    {hunkAction && diff.hunkActions && (
                      <Button size="sm" variant="ghost" icon={hunkAction.icon} disabled={busy} onClick={() => hunkAction.run(r.hunk)} className="shrink-0">
                        {hunkAction.label}
                      </Button>
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                    )}
                  </div>
                </div>
              );
            if (r.t === "line")
              return (
                <div key={r.key} style={style} {...measure} className="flex">
<<<<<<< HEAD
                  <LineCells line={r.line} lang={lang} showEol={mixedEol} hi={r.hi} li={r.li} pick={pick} />
=======
                  <LineCells line={r.line} lang={lang} showEol={mixedEol} />
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                </div>
              );
            return (
              <div key={r.key} style={style} {...measure} className="flex">
                <div className="flex w-1/2 min-w-0 border-r border-border">
<<<<<<< HEAD
                  <LineCells side="left" line={r.left?.line.kind === "add" ? null : (r.left?.line ?? null)} lang={lang} showEol={mixedEol} hi={r.hi} li={r.left?.li} pick={pick} />
                </div>
                <div className="flex w-1/2 min-w-0">
                  <LineCells side="right" line={r.right?.line.kind === "del" ? null : (r.right?.line ?? null)} lang={lang} showEol={mixedEol} hi={r.hi} li={r.right?.li} pick={pick} />
=======
                  <LineCells side="left" line={r.left?.kind === "add" ? null : r.left} lang={lang} showEol={mixedEol} />
                </div>
                <div className="flex w-1/2 min-w-0">
                  <LineCells side="right" line={r.right?.kind === "del" ? null : r.right} lang={lang} showEol={mixedEol} />
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-sm">
          {renamed ? (
            <>
              <span className="truncate text-muted" title={diff.oldPath ?? ""}>{diff.oldPath}</span>
              <ArrowRight size={12} className="shrink-0 text-faint" aria-label="renamed to" />
              <span className="truncate font-medium" title={diff.newPath ?? ""}>{diff.newPath}</span>
            </>
          ) : (
            <span className="selectable truncate font-medium" title={path ?? ""}>{path}</span>
          )}
          {diff.newFile && <Badge tone="success">new</Badge>}
          {diff.deletedFile && !diff.conflictView && <Badge tone="danger">deleted</Badge>}
          {diff.conflictView && <Badge tone="warning">conflict</Badge>}
          {diff.similarity != null && renamed && <Badge>{diff.similarity}% similar</Badge>}
          {modeChanged && <Badge title="File mode changed">{diff.oldMode} → {diff.newMode}</Badge>}
        </div>
        {!diff.binary && !diff.conflictView && (
          <span className="shrink-0 font-mono text-xs tabular-nums" aria-label={`${diff.additions} additions, ${diff.deletions} deletions`}>
            <span className="text-added">+{diff.additions}</span> <span className="text-removed">−{diff.deletions}</span>
          </span>
        )}
<<<<<<< HEAD
        {pick.enabled && !sel && rows.length > 0 && (
          <span className="hidden shrink-0 text-xs text-faint lg:inline">Click + or − markers to pick lines</span>
        )}
=======
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
        {loading && <Spinner size={12} />}
        {!diff.conflictView && (
          <Segmented
            size="sm"
            label="Diff layout"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: "unified", label: <Rows3 size={13} aria-label="Unified" />, title: "Unified" },
              { value: "split", label: <Columns2 size={13} aria-label="Side by side" />, title: "Side by side" },
            ]}
          />
        )}
      </div>
      {diff.truncated && (
        <div className="shrink-0 border-b border-border bg-warning-bg px-3 py-1.5 text-sm text-warning">
<<<<<<< HEAD
          This diff is very large, so only the first part is shown. Hunk and line staging are disabled for it.
=======
          This diff is very large, so only the first part is shown. Hunk staging is disabled for it.
>>>>>>> e365a9fef3e0021574d3072637bd2f2d41a73854
        </div>
      )}
      {diff.conflictView && !diff.deletedFile && (
        <div className="shrink-0 border-b border-border bg-conflict-bg px-3 py-1.5 text-sm text-text">
          Edit the file in your editor to keep the lines you want and remove the conflict markers, then stage it to mark it resolved.
          <span className="ml-2 inline-flex items-center gap-3 text-muted">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent-soft ring-1 ring-accent/30" /> current branch</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-conflict-bg ring-1 ring-conflict/40" /> incoming</span>
          </span>
        </div>
      )}
      {body}
    </div>
  );
}

export const stageHunkIcon = <Plus size={12} />;
export const unstageHunkIcon = <Minus size={12} />;
