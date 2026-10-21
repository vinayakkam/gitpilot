import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { BlameResult } from "@/bindings/BlameResult";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { absoluteTime, relativeTime } from "@/lib/format";
import { highlightLine, languageFor } from "@/lib/highlight";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

const ROW = 20;

/** A run of consecutive lines from the same commit. */
type Row = { line: number; commit: number; first: boolean; content: string };

export function blameRows(b: BlameResult): Row[] {
  return b.lines.map((l, i) => ({ line: i + 1, commit: l.commit, first: i === 0 || b.lines[i - 1]!.commit !== l.commit, content: l.content }));
}

/** Who last changed each line of a file, and in which commit. Click a commit to open it in History. */
export function BlameView({ target, onClose }: { target: { path: string; rev: string | null } | null; onClose: () => void }) {
  const { activeRepo, settings, setSection, setHistoryJump } = useStore();
  const id = activeRepo?.id;
  const blame = useAsync(() => api.fileBlame(id!, target!.path, target!.rev), [id, target?.path, target?.rev], id != null && target !== null);
  const rows = useMemo(() => (blame.data ? blameRows(blame.data) : []), [blame.data]);
  const lang = settings?.syntaxHighlighting === false ? null : languageFor(target?.path);
  const parent = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => ROW, overscan: 30 });

  // Older commits get a fainter age bar, newest the strongest.
  const ages = useMemo(() => {
    const times = (blame.data?.commits ?? []).map((c) => c.time).filter((t) => t > 0);
    const min = Math.min(...times);
    const max = Math.max(...times);
    return (t: number) => (max > min ? 0.15 + 0.85 * ((t - min) / (max - min)) : 0.6);
  }, [blame.data]);

  const open = (hash: string) => {
    setHistoryJump(hash);
    setSection("history");
    onClose();
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      width={1100}
      title={`Blame: ${target?.path ?? ""}`}
      description={target?.rev ? `As of ${target.rev.slice(0, 7)}` : "Current version, including uncommitted changes. Click a commit to open it in History."}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {blame.loading && !blame.data ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner label="Reading the file's history" />
        </div>
      ) : blame.error ? (
        <ErrorNotice error={blame.error} />
      ) : (
        <>
          <div ref={parent} className="selectable h-[62vh] overflow-auto rounded border border-border bg-surface font-mono text-xs">
            <div style={{ height: virt.getTotalSize(), position: "relative", minWidth: "100%" }} className="hl">
              {virt.getVirtualItems().map((vi) => {
                const r = rows[vi.index]!;
                const c = blame.data!.commits[r.commit]!;
                const html = highlightLine(r.content, lang);
                return (
                  <div key={vi.key} className={`absolute left-0 flex w-full ${r.first ? "border-t border-border" : ""}`} style={{ top: vi.start, height: ROW }}>
                    <span className="w-1 shrink-0 bg-accent" style={{ opacity: c.uncommitted ? 1 : ages(c.time) }} />
                    {r.first ? (
                      <button
                        type="button"
                        disabled={c.uncommitted}
                        onClick={() => open(c.hash)}
                        title={c.uncommitted ? "Not committed yet" : `${c.summary}\n${c.author} · ${absoluteTime(c.time)}`}
                        className="flex w-[300px] shrink-0 items-center gap-2 overflow-hidden px-2 text-left font-sans hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {c.uncommitted ? (
                          <span className="text-warning">Not committed yet</span>
                        ) : (
                          <>
                            <span className="font-mono text-accent-text">{c.hash.slice(0, 7)}</span>
                            <span className="min-w-0 flex-1 truncate text-muted">{c.summary}</span>
                            <span className="shrink-0 text-faint">{relativeTime(c.time)}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="w-[300px] shrink-0" />
                    )}
                    <span className="w-12 shrink-0 select-none pr-2 text-right text-faint">{r.line}</span>
                    <span className="whitespace-pre pr-4">{html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : r.content}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {blame.data?.truncated && <p className="mt-2 text-sm text-muted">Only the first 20,000 lines are shown.</p>}
        </>
      )}
    </Dialog>
  );
}
