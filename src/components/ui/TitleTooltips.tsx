import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const DELAY = 450;

/**
 * Shows every `title` attribute as the app's own tooltip instead of the system one (which
 * renders as an unstyled GTK tooltip on Linux). Mounted once. While an element is hovered its
 * title moves to `data-gp-title`, so the native tooltip never appears; it's put back on leave.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: number | undefined;
    const restore = () => {
      window.clearTimeout(timer);
      if (current?.dataset.gpTitle !== undefined) {
        current.setAttribute("title", current.dataset.gpTitle);
        delete current.dataset.gpTitle;
      }
      current = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title]");
      if (!el || el === current) return;
      const text = el.getAttribute("title") ?? "";
      if (!text.trim()) return;
      restore();
      current = el;
      el.dataset.gpTitle = text;
      el.removeAttribute("title");
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 40 > window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above });
      }, DELAY);
    };
    const out = (e: MouseEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) restore();
    };
    document.addEventListener("mouseover", over, true);
    document.addEventListener("mouseout", out, true);
    document.addEventListener("mousedown", restore, true);
    document.addEventListener("keydown", restore, true);
    window.addEventListener("scroll", restore, true);
    return () => {
      restore();
      document.removeEventListener("mouseover", over, true);
      document.removeEventListener("mouseout", out, true);
      document.removeEventListener("mousedown", restore, true);
      document.removeEventListener("keydown", restore, true);
      window.removeEventListener("scroll", restore, true);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-80 whitespace-pre-line rounded bg-text px-2 py-1 text-sm text-surface shadow-overlay"
      style={{ left: Math.min(Math.max(tip.x, 90), window.innerWidth - 90), top: tip.y, transform: `translate(-50%, ${tip.above ? "-100%" : "0"})` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
