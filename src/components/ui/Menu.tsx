import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export type MenuItem =
  | { type?: "item"; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { type: "separator" }
  | { type: "label"; label: string };

export interface MenuPosition {
  x: number;
  y: number;
}

/** Keyboard-navigable popup menu used for context menus and dropdowns. */
export function Menu({ items, at, onClose, minWidth = 200 }: { items: MenuItem[]; at: MenuPosition; onClose: () => void; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const actionable = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => (it.type ?? "item") === "item" && !(it as { disabled?: boolean }).disabled);
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(at.x, window.innerWidth - r.width - 8),
      y: at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y,
    });
    el.focus();
  }, [at]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [onClose]);

  const select = (it: MenuItem) => {
    if ((it.type ?? "item") !== "item") return;
    const item = it as Extract<MenuItem, { onSelect: () => void }>;
    if (item.disabled) return;
    onClose();
    item.onSelect();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!actionable.length) return;
      const cur = actionable.findIndex((a) => a.i === active);
      const next = e.key === "ArrowDown" ? (cur + 1) % actionable.length : (cur - 1 + actionable.length) % actionable.length;
      setActive(actionable[next]?.i ?? -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = items[active];
      if (it) select(it);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      className="gp-pop fixed z-[90] rounded-md border border-border bg-surface py-1 text-base shadow-overlay outline-none"
      style={{ left: pos.x, top: pos.y, minWidth }}
    >
      {items.map((it, i) => {
        if (it.type === "separator") return <div key={i} role="separator" className="my-1 h-px bg-border" />;
        if (it.type === "label")
          return (
            <div key={i} className="px-3 pb-0.5 pt-1.5 text-xs font-medium text-faint">
              {it.label}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => select(it)}
            className={cx(
              "flex h-7 w-full items-center gap-2 px-3 text-left disabled:opacity-40",
              it.danger ? "text-danger" : "text-text",
              active === i && (it.danger ? "bg-removed-bg" : "bg-surface-2"),
            )}
          >
            <span className="flex w-4 shrink-0 justify-center text-muted">{it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-sm text-faint">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Helper hook: `open(e)` from onContextMenu or a button click. */
export function useMenu() {
  const [at, setAt] = useState<MenuPosition | null>(null);
  return {
    at,
    openAtPointer: (e: React.MouseEvent) => {
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY });
    },
    openBelow: (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setAt({ x: r.left, y: r.bottom + 4 });
    },
    close: () => setAt(null),
  };
}
