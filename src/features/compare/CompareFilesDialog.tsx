import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { CommitFile } from "@/bindings/CommitFile";
import type { FileDiff } from "@/bindings/FileDiff";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural, splitPath } from "@/lib/format";
import { useAsync, useDebounced } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

export type CompareTarget = { base: string; head: string };

/**
 * Compare any two branches, tags or commits file by file. "Since they split" shows what
 * `head` changed after branching from `base` (like a pull request); "Directly" compares the
 * two snapshots as they are.
 */
export function CompareFilesDialog({ target, onClose }: { target: CompareTarget | null; onClose: () => void }) {
  const { activeRepo, settings, saveSettings } = useStore();
  const id = activeRepo?.id;
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [mode, setMode] = useState<"split" | "direct">("split");
  const [sel, setSel] = useState<CommitFile | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffErr, setDiffErr] = useState<AppError | null>(null);

  useEffect(() => {
    if (target) {
      setBase(target.base);
      setHead(target.head);
      setSel(null);
    }
  }, [target]);

  const b = useDebounced(base.trim(), 400);
  const h = useDebounced(head.trim(), 400);
  const threeDot = mode === "split";
  const files = useAsync(() => api.compareFiles(id!, b, h, threeDot), [id, b, h, threeDot], id != null && !!b && !!h && target !== null);
  const refs = useAsync(async () => {
    const [br, tags] = await Promise.all([api.branches(id!), api.tagList(id!)]);
    return [...br.map((x) => x.name), ...tags.map((t) => t.name)];
  }, [id], id != null && target !== null);

  useEffect(() => {
    setSel((cur) => (cur && files.data?.some((f) => f.path === cur.path) ? cur : (files.data?.[0] ?? null)));
  }, [files.data]);

  useEffect(() => {
    if (id == null || !sel) {
      setDiff(null);
      return;
    }
    let live = true;
    setDiffLoading(true);
    api
      .compareFileDiff(id, b, h, threeDot, sel.path, sel.origPath)
      .then((d) => live && (setDiff(d), setDiffErr(null)))
      .catch((e) => live && (setDiff(null), setDiffErr(toAppError(e))))
      .finally(() => live && setDiffLoading(false));
    return () => {
      live = false;
    };
  }, [id, sel, b, h, threeDot]);

  const totals = useMemo(() => {
    const fs = files.data ?? [];
    return { add: fs.reduce((n, f) => n + (f.additions ?? 0), 0), del: fs.reduce((n, f) => n + (f.deletions ?? 0), 0) };
  }, [files.data]);

  return (
    <Dialog open={target !== null} onClose={onClose} width={1180} title="Compare" footer={<Button variant="primary" data-autofocus onClick={onClose}>Done</Button>}>
      <datalist id="compare-refs">{refs.data?.map((r) => <option key={r} value={r} />)}</datalist>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Input aria-label="Compare from" list="compare-refs" value={base} onChange={(e) => setBase(e.target.value)} className="font-mono text-sm" placeholder="main, v1.0.0 or a hash" />
        </div>
        <IconButton label="Swap sides" icon={<ArrowLeftRight size={14} />} onClick={() => (setBase(head), setHead(base))} />
        <div className="w-56">
          <Input aria-label="Compare to" list="compare-refs" value={head} onChange={(e) => setHead(e.target.value)} className="font-mono text-sm" placeholder="feature, HEAD or a hash" />
        </div>
        <Segmented
          label="Comparison"
          value={mode}
          onChange={setMode}
          options={[
            { value: "split", label: "Since they split" },
            { value: "direct", label: "Directly" },
          ]}
        />
        {files.data && (
          <span className="ml-auto text-sm text-muted">
            {plural(files.data.length, "file")} · <span className="text-added">+{totals.add}</span> <span className="text-removed">−{totals.del}</span>
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-faint">
        {threeDot ? `Changes made on ${h || "…"} since it split from ${b || "…"}, like a pull request.` : `Everything that differs between ${b || "…"} and ${h || "…"}.`}
      </p>
      <div className="flex h-[56vh] min-h-0 overflow-hidden rounded border border-border">
        <div className="w-[300px] shrink-0 overflow-y-auto border-r border-border">
          {files.loading && !files.data ? (
            <div className="flex justify-center p-4"><Spinner /></div>
          ) : files.error ? (
            <div className="p-2"><ErrorNotice compact error={files.error} /></div>
          ) : files.data?.length === 0 ? (
            <EmptyState title="No differences">These two point to the same content.</EmptyState>
          ) : (
            <ul role="listbox" aria-label="Changed files">
              {files.data?.map((f) => {
                const { name, dir } = splitPath(f.path);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={sel?.path === f.path}
                      onClick={() => setSel(f)}
                      className={cx("flex w-full items-center gap-2 px-2 py-1 text-left", sel?.path === f.path ? "bg-selection" : "hover:bg-surface-2")}
                    >
                      <StatusGlyph change={f.change} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-base">{name}</span>
                        {dir && <span className="ml-1.5 text-sm text-faint">{dir}</span>}
                      </span>
                      {!f.binary && (
                        <span className="shrink-0 text-xs tabular-nums">
                          <span className="text-added">+{f.additions ?? 0}</span> <span className="text-removed">−{f.deletions ?? 0}</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <DiffViewer
            diff={diff}
            loading={diffLoading}
            error={diffErr}
            mode={settings?.diffMode ?? "unified"}
            onModeChange={(m) => void saveSettings({ diffMode: m })}
            highlight={settings?.syntaxHighlighting ?? true}
            emptyTitle="Select a file"
          />
        </div>
      </div>
    </Dialog>
  );
}
