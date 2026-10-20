import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, ChevronRight, Copy, History, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import type { Area } from "@/bindings/Area";
import type { FileEntry } from "@/bindings/FileEntry";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { splitPath } from "@/lib/format";

export const keyOf = (f: { area: Area; path: string }) => `${f.area}:${f.path}`;

const SECTIONS: { area: Area; title: string }[] = [
  { area: "conflicted", title: "Conflicts" },
  { area: "staged", title: "Staged" },
  { area: "unstaged", title: "Changes" },
  { area: "untracked", title: "New files" },
];

export interface FileListActions {
  stage: (files: FileEntry[]) => void;
  unstage: (files: FileEntry[]) => void;
  discard: (files: FileEntry[]) => void;
  stageAll: () => void;
  unstageAll: () => void;
  copyPath: (path: string) => void;
  showHistory: (path: string) => void;
}

interface Props {
  files: FileEntry[];
  selected: Set<string>;
  focusKey: string | null;
  onSelect: (keys: Set<string>, focus: string) => void;
  actions: FileListActions;
  disabled?: boolean;
}

export function FileList({ files, selected, focusKey, onSelect, actions, disabled }: Props) {
  const [collapsed, setCollapsed] = useState<Set<Area>>(new Set());
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  const groups = useMemo(
    () => SECTIONS.map((s) => ({ ...s, files: files.filter((f) => f.area === s.area) })).filter((g) => g.files.length > 0),
    [files],
  );
  const visible = useMemo(() => groups.flatMap((g) => (collapsed.has(g.area) ? [] : g.files)), [groups, collapsed]);
  const byKey = useMemo(() => new Map(files.map((f) => [keyOf(f), f])), [files]);

  const selectedFiles = (fallback: FileEntry) => {
    const k = keyOf(fallback);
    if (!selected.has(k)) return [fallback];
    return [...selected].map((x) => byKey.get(x)).filter((f): f is FileEntry => !!f && f.area === fallback.area);
  };

  const click = (e: MouseEvent, f: FileEntry) => {
    const k = keyOf(f);
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((x) => keyOf(x) === anchor);
      const b = visible.findIndex((x) => keyOf(x) === k);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = visible.slice(lo, hi + 1).filter((x) => x.area === f.area);
        onSelect(new Set(range.map(keyOf)), k);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set([...selected].filter((x) => byKey.get(x)?.area === f.area));
      if (next.has(k)) next.delete(k);
      else next.add(k);
      onSelect(next.size ? next : new Set([k]), k);
      setAnchor(k);
      return;
    }
    onSelect(new Set([k]), k);
    setAnchor(k);
  };

  const primary = (f: FileEntry) => (f.area === "staged" ? actions.unstage : actions.stage);

  const contextMenu = (e: MouseEvent, f: FileEntry) => {
    e.preventDefault();
    const k = keyOf(f);
    if (!selected.has(k)) onSelect(new Set([k]), k);
    const targets = selectedFiles(f);
    const n = targets.length;
    const what = n > 1 ? `${n} files` : "file";
    const items: MenuItem[] = [];
    if (f.area === "staged") items.push({ label: `Unstage ${what}`, icon: <Minus size={14} />, onSelect: () => actions.unstage(targets) });
    else if (f.area === "conflicted") items.push({ label: n > 1 ? `Mark ${n} files resolved` : "Mark as resolved", icon: <Check size={14} />, onSelect: () => actions.stage(targets) });
    else items.push({ label: `Stage ${what}`, icon: <Plus size={14} />, onSelect: () => actions.stage(targets) });
    if (f.area === "unstaged")
      items.push({ label: n > 1 ? `Discard changes to ${n} files…` : "Discard changes…", icon: <Undo2 size={14} />, danger: true, onSelect: () => actions.discard(targets) });
    if (f.area === "untracked")
      items.push({ label: n > 1 ? `Move ${n} files to trash…` : "Move to trash…", icon: <Trash2 size={14} />, danger: true, onSelect: () => actions.discard(targets) });
    items.push({ type: "separator" });
    items.push({ label: "Copy path", icon: <Copy size={14} />, onSelect: () => actions.copyPath(f.path) });
    if (f.area !== "untracked") items.push({ label: "Show file history", icon: <History size={14} />, onSelect: () => actions.showHistory(f.path) });
    setMenu({ at: { x: e.clientX, y: e.clientY }, items });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!visible.length) return;
    const idx = visible.findIndex((x) => keyOf(x) === focusKey);
    const go = (i: number) => {
      const f = visible[Math.max(0, Math.min(visible.length - 1, i))];
      if (!f) return;
      const k = keyOf(f);
      if (e.shiftKey && focusKey) {
        const next = new Set(selected);
        if (byKey.get(focusKey)?.area === f.area) next.add(k);
        onSelect(next, k);
      } else {
        onSelect(new Set([k]), k);
        setAnchor(k);
      }
      document.getElementById(`file-${k}`)?.scrollIntoView({ block: "nearest" });
    };
    const cur = focusKey ? byKey.get(focusKey) : undefined;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      go(idx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(idx - 1);
    } else if ((e.key === " " || e.key === "Enter") && cur && !disabled) {
      e.preventDefault();
      primary(cur)(selectedFiles(cur));
    } else if ((e.key === "Delete" || e.key === "Backspace") && cur && !disabled && (cur.area === "unstaged" || cur.area === "untracked")) {
      e.preventDefault();
      actions.discard(selectedFiles(cur));
    }
  };

  const hasStaged = files.some((f) => f.area === "staged");
  const hasUnstaged = files.some((f) => f.area !== "staged");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="listbox"
        aria-label="Changed files"
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKey}
        className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.area);
          return (
            <div key={g.area} role="group" aria-label={g.title}>
              <div className="sticky top-0 z-[1] flex h-8 items-center gap-1 bg-surface pl-1.5 pr-2">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(g.area)) n.delete(g.area);
                      else n.add(g.area);
                      return n;
                    })
                  }
                  className="flex flex-1 items-center gap-1 text-sm font-semibold text-muted hover:text-text"
                >
                  <ChevronRight size={13} className={cx("transition-transform", !isCollapsed && "rotate-90")} />
                  <span className={g.area === "conflicted" ? "text-conflict" : undefined}>{g.title}</span>
                  <span className="font-normal tabular-nums text-faint">{g.files.length}</span>
                </button>
                {g.area === "staged" ? (
                  <Button size="sm" variant="ghost" disabled={disabled} onClick={actions.unstageAll}>
                    Unstage all
                  </Button>
                ) : g.area !== "conflicted" ? (
                  <Button size="sm" variant="ghost" disabled={disabled} onClick={() => actions.stage(g.files)}>
                    Stage all
                  </Button>
                ) : null}
              </div>
              {!isCollapsed &&
                g.files.map((f) => {
                  const k = keyOf(f);
                  const { name, dir } = splitPath(f.path);
                  const isSel = selected.has(k);
                  return (
                    <div
                      key={k}
                      id={`file-${k}`}
                      role="option"
                      aria-selected={isSel}
                      onClick={(e) => click(e, f)}
                      onContextMenu={(e) => contextMenu(e, f)}
                      className={cx(
                        "group mx-1 flex items-center gap-2 rounded pl-5 pr-1",
                        isSel ? "bg-selection" : "hover:bg-surface-2",
                        focusKey === k && "ring-1 ring-inset ring-accent/40",
                      )}
                      style={{ height: "var(--row-h)" }}
                      title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                    >
                      <StatusGlyph change={f.change} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-base">{name}</span>
                        {f.conflict && <span className="ml-1.5 text-xs text-conflict">{f.conflict}</span>}
                        {dir && <span className="ml-1.5 text-sm text-faint">{dir}</span>}
                      </span>
                      <span className={cx("flex shrink-0 items-center", !isSel && "opacity-0 group-hover:opacity-100")}>
                        {f.area === "unstaged" && (
                          <IconButton size="sm" tone="danger" label="Discard changes…" icon={<Undo2 size={13} />} disabled={disabled} onClick={(e) => { e.stopPropagation(); actions.discard(selectedFiles(f)); }} />
                        )}
                        {f.area === "staged" ? (
                          <IconButton size="sm" label="Unstage" icon={<Minus size={14} />} disabled={disabled} onClick={(e) => { e.stopPropagation(); actions.unstage(selectedFiles(f)); }} />
                        ) : f.area === "conflicted" ? (
                          <IconButton size="sm" label="Mark as resolved (stage)" icon={<Check size={14} />} disabled={disabled} onClick={(e) => { e.stopPropagation(); actions.stage(selectedFiles(f)); }} />
                        ) : (
                          <IconButton size="sm" label="Stage" icon={<Plus size={14} />} disabled={disabled} onClick={(e) => { e.stopPropagation(); actions.stage(selectedFiles(f)); }} />
                        )}
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      {(hasStaged || hasUnstaged) && (
        <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} disabled={disabled || !hasUnstaged} onClick={actions.stageAll}>
            Stage everything
          </Button>
          <Button size="sm" variant="ghost" icon={<Minus size={12} />} disabled={disabled || !hasStaged} onClick={actions.unstageAll}>
            Unstage everything
          </Button>
        </div>
      )}
      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
