import { useCallback, useEffect, useRef, useState } from "react";

function load(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(`gp.split.${key}`));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Width state for a resizable side panel, remembered per key. */
export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const [w, setW] = useState(() => Math.min(max, Math.max(min, load(key, initial))));
  const set = useCallback(
    (v: number) => {
      const c = Math.min(max, Math.max(min, v));
      setW(c);
      try {
        localStorage.setItem(`gp.split.${key}`, String(Math.round(c)));
      } catch {
        /* storage unavailable: width just isn't remembered */
      }
    },
    [key, min, max],
  );
  return [w, set] as const;
}

/** Vertical drag handle between two panels. Keyboard: arrow keys resize. */
export function Splitter({ width, onChange, label }: { width: number; onChange: (w: number) => void; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (start.current) onChange(start.current.w + (e.clientX - start.current.x));
    };
    const up = () => setDrag(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
  }, [drag, onChange]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        setDrag(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(width - 16);
        if (e.key === "ArrowRight") onChange(width + 16);
      }}
      className="group relative z-10 -mx-[3px] w-[7px] shrink-0 cursor-col-resize"
    >
      <div className={`mx-auto h-full w-px transition-colors ${drag ? "bg-accent" : "bg-border group-hover:bg-border-strong"}`} />
    </div>
  );
}
