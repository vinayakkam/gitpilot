import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { ConflictHelp } from "@/bindings/ConflictHelp";
import type { ConflictSuggestion } from "@/bindings/ConflictSuggestion";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { AiError, AiNote } from "@/features/assistant/AiNote";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

/** A suggestion with an id that stays the same while conflict numbers shift. */
type Item = ConflictSuggestion & { uid: number };

/** After a suggestion for conflict `applied` is used, later conflicts move up by one. */
export function afterApplying<T extends ConflictSuggestion>(list: T[], applied: number): T[] {
  return list.filter((s) => s.index !== applied).map((s) => (s.index > applied ? { ...s, index: s.index - 1 } : s));
}

/** AI suggestions for the conflicts in one file. Nothing changes until the user applies one. */
export function ConflictHelpDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  const { activeRepo, run } = useStore();
  const id = activeRepo?.id;
  const [help, setHelp] = useState<ConflictHelp | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const seq = useRef(0);

  const ask = async () => {
    if (id == null || !path) return;
    const s = ++seq.current;
    setHelp(null);
    setItems([]);
    setEdits({});
    setError(null);
    setLoading(true);
    try {
      const h = await api.aiConflictHelp(id, path);
      if (s !== seq.current) return;
      setHelp(h);
      setItems(h.suggestions.map((x, uid) => ({ ...x, uid })));
    } catch (e) {
      if (s === seq.current) setError(toAppError(e));
    } finally {
      if (s === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (path) void ask();
    else seq.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, id]);

  const apply = async (s: Item) => {
    if (id == null || !path) return;
    setApplying(s.uid);
    const text = edits[s.uid] ?? s.resolution;
    const left = await run("Apply suggestion", () => api.conflictApplyText(id, path, s.index, s.block, text), { success: "Suggestion applied" });
    setApplying(null);
    if (left === undefined) return;
    const next = afterApplying(items, s.index);
    setItems(next);
    if (next.length === 0) onClose();
  };

  return (
    <Dialog
      open={path !== null}
      onClose={onClose}
      busy={applying !== null}
      width={720}
      title="Conflict help"
      description={path ? <span className="font-mono text-sm">{path}</span> : undefined}
      footer={
        <>
          {(help || error) && (
            <Button icon={<RefreshCw size={13} />} onClick={() => void ask()} disabled={applying !== null}>
              Ask again
            </Button>
          )}
          <Button variant="primary" onClick={onClose} autoFocus disabled={applying !== null}>
            Close
          </Button>
        </>
      }
    >
      <div className="flex min-h-[120px] flex-col gap-4" aria-live="polite" aria-busy={loading}>
        {loading && (
          <p className="flex items-center gap-2 text-base text-muted">
            <Spinner size={12} /> Asking the AI…
          </p>
        )}
        {error && <AiError error={error} onSetUp={onClose} />}
        {help && (
          <>
            {help.summary && <p className="selectable text-base">{help.summary}</p>}
            {items.map((s) => (
              <section key={s.uid} className="flex flex-col gap-2 rounded border border-border p-3" aria-label={`Conflict ${s.index + 1}`}>
                <div className="flex items-center gap-2">
                  <h3 className="flex-1 text-base font-semibold text-conflict">Conflict {s.index + 1}</h3>
                  <Button size="sm" variant="primary" icon={<Check size={12} />} loading={applying === s.uid} disabled={applying !== null} onClick={() => void apply(s)}>
                    Use this
                  </Button>
                </div>
                {s.explanation && <p className="selectable text-base text-muted">{s.explanation}</p>}
                <TextArea
                  aria-label={`Suggested text for conflict ${s.index + 1}`}
                  spellCheck={false}
                  rows={Math.min(12, Math.max(2, (edits[s.uid] ?? s.resolution).split("\n").length))}
                  className="font-mono text-sm"
                  value={edits[s.uid] ?? s.resolution}
                  onChange={(e) => setEdits((m) => ({ ...m, [s.uid]: e.target.value }))}
                />
              </section>
            ))}
            {items.length === 0 && <p className="text-base text-muted">All suggestions have been used.</p>}
            <p className="text-sm text-muted">You can edit a suggestion before using it. Using one replaces that conflict in the file; review the result, then mark the file as resolved.</p>
            <AiNote model={help.model} excludedFiles={[]} truncated={false} />
          </>
        )}
      </div>
    </Dialog>
  );
}
