import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useStore } from "@/store/AppStore";

export type FunKind = "pull" | "push" | "fetch" | "commit";

/** Where the handle starts and ends in the 400×240 scene; dragging along that line fills the bar. */
interface Scene {
  title: string;
  hint: string;
  skip: string;
  from: [number, number];
  to: [number, number];
  /** The scene behind the handle at progress `p` (0…1). */
  draw: (p: number) => ReactNode;
  handle: ReactNode;
}

const ink = "var(--text-muted)";
const SCENES: Record<FunKind, Scene> = {
  pull: {
    title: "Pull the rope",
    hint: "Drag the handle all the way down to pull in the new commits.",
    skip: "Just pull",
    from: [200, 70],
    to: [200, 215],
    draw: (p) => (
      <>
        <rect x="150" y="14" width="100" height="10" rx="2" fill="var(--surface-3)" stroke={ink} />
        <circle cx="200" cy="32" r="10" fill="var(--surface)" stroke={ink} strokeWidth="2" />
        <line x1="200" y1="42" x2="200" y2={70 + p * 145} stroke="var(--modified)" strokeWidth="4" strokeDasharray="6 3" strokeDashoffset={-p * 60} />
        {/* The bucket of commits rises as the rope comes down. */}
        <line x1="210" y1="32" x2="290" y2={150 - p * 100} stroke="var(--modified)" strokeWidth="3" />
        <rect x="262" y={150 - p * 100} width="56" height="30" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x="290" y={170 - p * 100} textAnchor="middle" fontSize="11" fill="var(--accent-text)">commits</text>
      </>
    ),
    handle: <rect x="-14" y="-6" width="28" height="18" rx="6" fill="var(--accent)" />,
  },
  push: {
    title: "Push the car up the hill",
    hint: "Drag the car to the top so your commits reach the remote.",
    skip: "Just push",
    from: [70, 190],
    to: [330, 70],
    draw: () => (
      <>
        <path d="M20 215 L330 72 L390 72 L390 230 L20 230 Z" fill="var(--surface-3)" />
        <line x1="20" y1="215" x2="330" y2="72" stroke={ink} strokeWidth="2" />
        <line x1="355" y1="72" x2="355" y2="30" stroke={ink} strokeWidth="2" />
        <path d="M355 30 L385 38 L355 46 Z" fill="var(--success)" />
        <text x="360" y="64" fontSize="11" fill="var(--text-muted)">remote</text>
      </>
    ),
    // Tilted to sit on the slope (about −25°).
    handle: (
      <g transform="rotate(-25) translate(0 -16)">
        <rect x="-26" y="-12" width="52" height="16" rx="4" fill="var(--accent)" />
        <path d="M-14 -12 L-8 -22 L10 -22 L16 -12 Z" fill="var(--accent-soft)" stroke="var(--accent)" />
        <circle cx="-15" cy="6" r="6" fill="var(--text)" />
        <circle cx="15" cy="6" r="6" fill="var(--text)" />
      </g>
    ),
  },
  fetch: {
    title: "Throw the ball",
    hint: "Drag the ball across the park. The dog fetches what's new on the remote.",
    skip: "Just fetch",
    from: [90, 170],
    to: [350, 170],
    draw: (p) => (
      <>
        <line x1="10" y1="200" x2="390" y2="200" stroke={ink} strokeWidth="2" />
        {/* The dog: a few shapes, chasing a bit behind the ball. */}
        <g transform={`translate(${32 + p * 270} 180)`}>
          <rect x="-18" y="-10" width="30" height="14" rx="6" fill="var(--modified)" />
          <circle cx="16" cy="-12" r="8" fill="var(--modified)" />
          <path d="M18 -20 L24 -26 L22 -16 Z" fill="var(--text)" />
          <line x1="-12" y1="4" x2="-12" y2="18" stroke="var(--modified)" strokeWidth="4" />
          <line x1="6" y1="4" x2="6" y2="18" stroke="var(--modified)" strokeWidth="4" />
          <line x1="-18" y1="-6" x2="-28" y2={-16 + (p * 40) % 8} stroke="var(--modified)" strokeWidth="3" />
        </g>
      </>
    ),
    handle: <circle r="11" fill="var(--success)" stroke="var(--text)" strokeWidth="1.5" />,
  },
  commit: {
    title: "Stamp your commit",
    hint: "Drag the stamp down onto the page to seal this snapshot.",
    skip: "Just commit",
    from: [200, 45],
    to: [200, 150],
    draw: (p) => (
      <>
        <rect x="110" y="165" width="180" height="60" rx="3" fill="var(--surface)" stroke={ink} />
        <line x1="125" y1="185" x2="275" y2="185" stroke="var(--border-strong)" strokeWidth="3" />
        <line x1="125" y1="200" x2="240" y2="200" stroke="var(--border-strong)" strokeWidth="3" />
        {p >= 1 && <text x="200" y="215" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--danger)">COMMITTED</text>}
      </>
    ),
    handle: (
      <g>
        <rect x="-8" y="-30" width="16" height="22" rx="3" fill="var(--text-muted)" />
        <rect x="-26" y="-8" width="52" height="14" rx="3" fill="var(--danger)" />
      </g>
    ),
  },
};

const DONE = 0.97;

/** Projects a drag onto the line `from → to` and returns progress 0…1. */
export function progressAlong(from: [number, number], to: [number, number], start: number, dx: number, dy: number): number {
  const ax = to[0] - from[0];
  const ay = to[1] - from[1];
  return Math.min(1, Math.max(0, start + (dx * ax + dy * ay) / (ax * ax + ay * ay)));
}

/** Fun mode: a small physical task before a Git action. Never blocks: there's always a skip button. */
export function FunGate({ kind, onDone, onCancel }: { kind: FunKind | null; onDone: () => void; onCancel: () => void }) {
  const scene = kind ? SCENES[kind] : null;
  const [p, setP] = useState(0);
  const [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; start: number; scale: number } | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    setP(0);
    finished.current = false;
  }, [kind]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setP(1);
    // A moment to see the result before the dialog goes.
    window.setTimeout(onDone, 350);
  }, [onDone]);

  if (!scene) return <Dialog open={false} onClose={onCancel} title="" />;
  const x = scene.from[0] + (scene.to[0] - scene.from[0]) * p;
  const y = scene.from[1] + (scene.to[1] - scene.from[1]) * p;
  const release = () => {
    drag.current = null;
    setDragging(false);
    if (p >= DONE) finish();
    else setP(0);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      width={480}
      title={scene.title}
      description={scene.hint}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <span className="flex-1" />
          <Button onClick={finish}>{scene.skip}</Button>
        </>
      }
    >
      <svg ref={svg} viewBox="0 0 400 240" className="w-full touch-none select-none rounded border border-border bg-surface-2" role="img" aria-label={scene.title}>
        {scene.draw(p)}
        <g
          role="slider"
          tabIndex={0}
          aria-label={scene.title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p * 100)}
          data-autofocus
          transform={`translate(${x} ${y})`}
          className="cursor-grab outline-none focus-visible:[&>*]:stroke-[var(--focus)]"
          style={{ transition: dragging ? "none" : "transform 300ms ease-out" }}
          onPointerDown={(e) => {
            const r = svg.current?.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, start: p, scale: r ? 400 / r.width : 1 };
            setDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setP(progressAlong(scene.from, scene.to, d.start, (e.clientX - d.x) * d.scale, (e.clientY - d.y) * d.scale));
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            const step = { ArrowDown: 0.1, ArrowRight: 0.1, ArrowUp: -0.1, ArrowLeft: -0.1 }[e.key];
            if (e.key === "End" || ((e.key === "Enter" || e.key === " ") && p >= DONE)) {
              e.preventDefault();
              finish();
            } else if (step) {
              e.preventDefault();
              const next = Math.min(1, Math.max(0, p + step));
              setP(next);
              if (next >= DONE) finish();
            }
          }}
        >
          {scene.handle}
        </g>
      </svg>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${p * 100}%` }} />
      </div>
    </Dialog>
  );
}

/** Runs `run` right away, or after the fun-mode task when `settings.funMode` is on. */
export function useFunGate() {
  const { settings } = useStore();
  const [pending, setPending] = useState<{ kind: FunKind; run: () => void } | null>(null);
  const gate = useCallback(
    (kind: FunKind, run: () => void) => {
      if (settings?.funMode) setPending({ kind, run });
      else run();
    },
    [settings?.funMode],
  );
  const element = (
    <FunGate
      kind={pending?.kind ?? null}
      onCancel={() => setPending(null)}
      onDone={() => {
        const run = pending?.run;
        setPending(null);
        run?.();
      }}
    />
  );
  return { gate, element };
}
