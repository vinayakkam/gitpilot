import { useEffect, useMemo, useState } from "react";
import type { AppError } from "@/bindings/AppError";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Field";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";

export interface PickItem {
  value: string;
  label: string;
  hint?: string;
  /** Hex without '#' (GitHub label colours). */
  color?: string;
}

/** Choose several items from a searchable list (reviewers, labels). */
export function PickListDialog({
  open,
  onClose,
  title,
  items,
  loading,
  error,
  initial,
  emptyText,
  saveLabel,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: PickItem[] | null;
  loading: boolean;
  error: AppError | null;
  initial: string[];
  emptyText: string;
  saveLabel: string;
  /** Throws to keep the dialog open. */
  onSave: (selected: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setQuery("");
      setPicked(new Set(initial));
    }
    // `initial` is read when the dialog opens only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => !q || i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q));
  }, [items, query]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave([...picked]);
      onClose();
    } catch {
      // The caller reported it; stay open so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={saving}
      title={title}
      width={420}
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!items} onClick={() => void save()}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <SearchField label="Filter" placeholder="Filter" value={query} onChange={setQuery} data-autofocus />
        <div className="max-h-72 overflow-y-auto rounded border border-border p-1">
          {loading && !items && <Spinner className="m-2" label="Loading" />}
          {error && <ErrorNotice compact className="m-1" error={error} />}
          {items && shown.length === 0 && <EmptyState title={items.length ? "Nothing matches" : emptyText} />}
          {shown.map((i) => (
            <Checkbox
              key={i.value}
              className="rounded px-2 py-1 hover:bg-surface-2"
              checked={picked.has(i.value)}
              onChange={(on) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (on) next.add(i.value);
                  else next.delete(i.value);
                  return next;
                })
              }
              label={
                <span className="flex items-center gap-2">
                  {i.color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ background: `#${i.color}` }} />}
                  <span>{i.label}</span>
                  {i.hint && <span className="truncate text-sm text-faint">{i.hint}</span>}
                </span>
              }
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
