import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RebaseAction } from "@/bindings/RebaseAction";
import type { RebaseCommit } from "@/bindings/RebaseCommit";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Select, TextArea } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { useIntegrate } from "@/lib/useIntegrate";
import { api } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

type Item = RebaseCommit & { action: RebaseAction; newMessage: string };

const ACTIONS: { value: RebaseAction; label: string }[] = [
  { value: "pick", label: "Keep" },
  { value: "reword", label: "Edit message" },
  { value: "squash", label: "Combine with previous" },
  { value: "fixup", label: "Combine, drop this message" },
  { value: "drop", label: "Remove" },
];

/** Describes what the edit will do, and whether it's valid. */
export function summarize(items: Pick<Item, "action" | "newMessage" | "hash">[], original: string[]): { result: number; problem: string | null; changed: boolean } {
  const kept = items.filter((i) => i.action !== "drop");
  const result = kept.filter((i) => i.action !== "squash" && i.action !== "fixup").length;
  const firstKept = items.find((i) => i.action !== "drop");
  let problem: string | null = null;
  if (kept.length === 0) problem = "Keep at least one commit.";
  else if (firstKept && (firstKept.action === "squash" || firstKept.action === "fixup")) problem = "The first commit can't be combined with a previous one.";
  else if (items.some((i) => i.action === "reword" && !i.newMessage.trim())) problem = "Write the new message for each commit you edit.";
  const changed = items.some((i) => i.action !== "pick") || items.map((i) => i.hash).join() !== original.join();
  return { result, problem, changed };
}

/**
 * Interactive rebase without a text editor: reorder, reword, combine or remove the commits
 * after `base`. A backup of the branch is saved first.
 */
export function EditCommitsDialog({ target, onClose }: { target: { base: string | null; from: string } | null; onClose: () => void }) {
  const { activeRepo, status } = useStore();
  const integrate = useIntegrate();
  const id = activeRepo?.id;
  const list = useAsync(() => api.rebaseCommits(id!, target!.base), [id, target?.base, target?.from], id != null && target !== null);
  const [items, setItems] = useState<Item[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (list.data) setItems(list.data.map((c) => ({ ...c, action: "pick", newMessage: c.message })));
    setAck(false);
  }, [list.data]);

  const original = useMemo(() => (list.data ?? []).map((c) => c.hash), [list.data]);
  const { result, problem, changed } = summarize(items, original);
  const pushed = items.some((i) => i.pushed);
  const merges = items.some((i) => i.isMerge);
  const dirty = (status?.files ?? []).some((f) => f.area !== "untracked");

  const move = (i: number, d: -1 | 1) =>
    setItems((cur) => {
      const next = cur.slice();
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const update = (i: number, patch: Partial<Item>) => setItems((cur) => cur.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  const run = async () => {
    if (!id || !target || problem) return;
    setBusy(true);
    const steps = items.map((i) => ({
      hash: i.hash,
      action: i.action,
      message: i.action === "reword" || (i.action === "squash" && i.newMessage.trim()) ? i.newMessage : null,
    }));
    const ok = await integrate("Edit commits", async () => void (await api.rebaseInteractive(id, target.base, steps, pushed)), `Rewrote ${plural(items.length, "commit")}. A backup was saved under Branches → Backups.`);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      busy={busy}
      width={860}
      title="Edit commits"
      description="Reorder, reword, combine or remove commits on this branch. Oldest is at the top. A backup is saved first, so you can always go back."
      onSubmit={run}
      footer={
        <>
          {items.length > 0 && <span className="mr-auto text-sm text-muted">{plural(items.length, "commit")} → {plural(result, "commit")}</span>}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!!problem || !changed || merges || dirty || (pushed && !ack)}>
            Rewrite commits
          </Button>
        </>
      }
    >
      {list.loading && !list.data ? (
        <div className="flex justify-center p-6"><Spinner /></div>
      ) : list.error ? (
        <ErrorNotice error={list.error} />
      ) : (
        <div className="flex flex-col gap-3">
          {merges && <ErrorNotice error={{ kind: "invalidInput", message: "These commits include a merge. Editing history across merges isn't supported; pick a newer starting commit.", detail: null }} />}
          {dirty && <ErrorNotice error={{ kind: "invalidInput", message: "Commit or stash your changes first, so they can't get mixed into the rewritten commits.", detail: null }} />}
          <ol className="max-h-[52vh] overflow-y-auto rounded border border-border">
            {items.map((it, i) => (
              <li key={it.hash} className={cx("border-b border-border px-2 py-1.5 last:border-b-0", it.action === "drop" && "opacity-50")}>
                <div className="flex items-center gap-2">
                  <span className="flex flex-col">
                    <IconButton size="sm" label="Move up (earlier)" icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton size="sm" label="Move down (later)" icon={<ArrowDown size={12} />} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                  </span>
                  <span className="font-mono text-xs text-faint">{it.shortHash}</span>
                  <span className={cx("min-w-0 flex-1 truncate text-base", it.action === "drop" && "line-through")}>{it.subject}</span>
                  {it.pushed && <span className="text-xs text-warning">pushed</span>}
                  <span className="shrink-0 text-xs text-faint">{relativeTime(it.time)}</span>
                  <div className="w-52 shrink-0">
                    <Select
                      aria-label={`Action for ${it.subject}`}
                      value={it.action}
                      onChange={(e) => {
                        const action = e.target.value as RebaseAction;
                        // Combining joins both messages unless a new one is written.
                        update(i, { action, newMessage: action === "squash" ? "" : it.newMessage || it.message });
                      }}
                    >
                      {ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                {(it.action === "reword" || it.action === "squash") && (
                  <TextArea
                    aria-label={`New message for ${it.subject}`}
                    rows={3}
                    className="mt-1.5 font-mono text-sm"
                    value={it.newMessage}
                    placeholder={it.action === "squash" ? "Message for the combined commit. Leave empty to join both messages." : "New message"}
                    onChange={(e) => update(i, { newMessage: e.target.value })}
                  />
                )}
              </li>
            ))}
          </ol>
          {problem && changed && <p className="text-sm text-warning">{problem}</p>}
          {pushed && (
            <div className="rounded border border-warning/30 bg-warning-bg p-2.5 text-sm">
              <Checkbox checked={ack} onChange={setAck} label="Some of these commits are already pushed. I understand I'll need to push with force (with lease), and others will need to reconcile." />
            </div>
          )}
          <p className="text-xs text-faint">If a reordered commit conflicts, GitPilot pauses so you can resolve it, then Continue, Skip or Abort from Changes.</p>
        </div>
      )}
    </Dialog>
  );
}
