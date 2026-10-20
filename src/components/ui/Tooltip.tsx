import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TriggerProps {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  "aria-describedby"?: string;
}

let nextId = 0;

/** Hover/focus tooltip rendered in a portal so it never clips. */
export function Tooltip({ content, children, side = "bottom" }: { content: ReactNode; children: ReactElement<TriggerProps>; side?: "top" | "bottom" }) {
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [id] = useState(() => `gp-tip-${++nextId}`);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!content) return children;

  const show = (el: Element) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const above = side === "top" ? r.top > 40 : r.bottom + 36 > window.innerHeight;
      setPos({ x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above });
    }, 450);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  const p = children.props;
  return (
    <>
      {cloneElement(children, {
        "aria-describedby": pos ? id : p["aria-describedby"],
        onMouseEnter: (e: React.MouseEvent) => {
          p.onMouseEnter?.(e);
          show(e.currentTarget);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          p.onMouseLeave?.(e);
          hide();
        },
        onFocus: (e: React.FocusEvent) => {
          p.onFocus?.(e);
          if ((e.target as HTMLElement).matches(":focus-visible")) show(e.currentTarget);
        },
        onBlur: (e: React.FocusEvent) => {
          p.onBlur?.(e);
          hide();
        },
      })}
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] max-w-72 rounded bg-text px-2 py-1 text-sm text-surface shadow-overlay"
            style={{
              left: Math.min(Math.max(pos.x, 80), window.innerWidth - 80),
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? "-100%" : "0"})`,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
