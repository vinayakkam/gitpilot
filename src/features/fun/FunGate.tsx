import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useStore } from "@/store/AppStore";

export type FunKind = "pull" | "push" | "fetch" | "commit";

/** What the scene can show about the real operation: commits to move, the commit summary. */
export interface FunInfo {
  count?: number;
  label?: string;
}

/**
 * The Git operation behind a scene. It runs when the task is done; resolving to `false` means it
 * failed, and the scene plays its failure (anything else counts as success).
 */
export type FunAction = () => unknown;

/** A throw in the fetch scene: when it started (scene clock, s) and how hard (0…1). */
interface Throw {
  at: number;
  power: number;
}

/** Everything a scene needs to draw one frame. Times are seconds on the scene clock. */
interface Frame {
  p: number;
  /** Scene clock (0 when motion is reduced). */
  t: number;
  dragging: boolean;
  /** True while the heavy car is actually moving. */
  moving: boolean;
  /** Since the task was finished (the operation started), or null while playing. */
  end: number | null;
  /** Since the operation succeeded / failed. */
  won: number | null;
  lost: number | null;
  info: FunInfo;
  /** Since the ball left the hand, and its power (fetch only). */
  thr: { e: number; power: number } | null;
  /** The car rolling back down: since when, and from where (push only). */
  back: { e: number; from: number } | null;
}

interface Scene {
  title: string;
  hint: string;
  skip: string;
  retry: string;
  working: string;
  failed: string;
  done: (info: FunInfo) => string;
  /** Where the handle starts and ends in the 400×240 scene; dragging along that line is progress. */
  from: [number, number];
  to: [number, number];
  /** Overrides the handle position (animations after the drag). */
  pos?: (f: Frame) => [number, number] | null;
  draw: (f: Frame) => ReactNode;
  handle: (f: Frame) => ReactNode;
}

// Colours come from tokens.css (`--fun-*` for the illustrations), so both themes work.
const ink = "var(--text-muted)";
const shade = "var(--fun-shade)";
const shine = "var(--fun-shine)";
const COLORS = ["var(--accent)", "var(--success)", "var(--modified)", "var(--renamed)", "var(--danger)", "var(--conflict)"];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shown = (info: FunInfo, max: number) => clamp(info.count ?? 3, 1, max);
/** Falling from rest: distance after `e` seconds at gravity `g` px/s². */
const drop = (e: number, g = 700) => 0.5 * g * e * e;

/** Confetti from (x, y), `e` seconds after the burst. Deterministic, so frames don't flicker. */
function Burst({ x, y, e, n = 22, colors = COLORS }: { x: number; y: number; e: number; n?: number; colors?: string[] }) {
  if (e > 1.2) return null;
  return (
    <g opacity={clamp(1.2 - e)}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.sin(i * 12.9) * 0.4;
        const v = 70 + ((i * 37) % 80);
        const px = x + Math.cos(a) * v * e;
        const py = y + Math.sin(a) * v * e + 160 * e * e;
        const color = colors[i % colors.length];
        return i % 2 ? (
          <rect key={i} x={px - 3} y={py - 2} width="6" height="4" rx="1" fill={color} transform={`rotate(${e * 400 + i * 30} ${px} ${py})`} />
        ) : (
          <circle key={i} cx={px} cy={py} r="2.6" fill={color} />
        );
      })}
    </g>
  );
}

/** A puff of dust where something lands. */
function Dust({ x, y, e }: { x: number; y: number; e: number }) {
  if (e < 0 || e > 0.8) return null;
  return (
    <g fill="var(--fun-cloud)" opacity={0.9 - e}>
      {[-1, -0.5, 0.5, 1].map((d) => (
        <circle key={d} cx={x + d * (14 + e * 50)} cy={y - 4 - e * 10 * Math.abs(d)} r={4 + e * 8} />
      ))}
    </g>
  );
}

/** A soft cloud that drifts across the sky. */
function Cloud({ t, y, offset, speed, size = 1 }: { t: number; y: number; offset: number; speed: number; size?: number }) {
  const x = ((t * speed + offset) % 480) - 60;
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} fill="var(--fun-cloud)">
      <ellipse cx="0" cy="0" rx="24" ry="8" />
      <circle cx="-9" cy="-5" r="9" />
      <circle cx="7" cy="-8" r="12" />
      <circle cx="19" cy="-2" r="7" />
    </g>
  );
}

/** Sky, sun and far hills: the same backdrop for every outdoor scene. */
function Backdrop({ t, sun = [58, 44] }: { t: number; sun?: [number, number] }) {
  return (
    <>
      <rect width="400" height="240" fill="var(--fun-sky)" />
      <circle cx={sun[0]} cy={sun[1]} r={22 + Math.sin(t * 1.5) * 1.5} fill="var(--fun-sun)" opacity="0.25" />
      <circle cx={sun[0]} cy={sun[1]} r="14" fill="var(--fun-sun)" />
      <Cloud t={t} y={38} offset={140} speed={7} />
      <Cloud t={t} y={64} offset={380} speed={4} size={0.7} />
      <path d="M0 176 Q60 140 120 160 T250 150 T400 140 L400 240 L0 240 Z" fill="var(--fun-hill-far)" />
    </>
  );
}

/** A speech bubble with a word in it. */
function Bubble({ x, y, text, tone = "var(--text)" }: { x: number; y: number; text: string; tone?: string }) {
  const w = text.length * 7 + 14;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y="-14" width={w} height="20" rx="8" fill="var(--surface)" stroke={ink} />
      <path d="M-4 6 L0 12 L4 6 Z" fill="var(--surface)" />
      <text y="0.5" textAnchor="middle" fontSize="11" fontWeight="800" fill={tone}>
        {text}
      </text>
    </g>
  );
}

/**
 * A person, feet at (0,0). Hands go where they're told; `lean` tilts the body and `fall`
 * tips the whole person over around the feet (degrees, negative = backwards).
 */
function Person({ x, y, lean = 0, hands, step = 0, fall = 0 }: { x: number; y: number; lean?: number; hands: [[number, number], [number, number]]; step?: number; fall?: number }) {
  // Shoulder position after the lean, so the arms stay attached.
  const rad = (lean * Math.PI) / 180;
  const sx = Math.sin(rad) * 26;
  const sy = -Math.cos(rad) * 26 - 12;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={fall * 0.3} cy="1" rx={13 + Math.abs(fall) * 0.25} ry="2.5" fill={shade} />
      <g transform={`rotate(${fall})`}>
        <g stroke="var(--fun-pants)" strokeWidth="5" strokeLinecap="round">
          <line x1="0" y1="-14" x2={-5 + step * 5} y2="0" />
          <line x1="0" y1="-14" x2={5 - step * 5} y2="0" />
        </g>
        <g transform={`rotate(${lean} 0 -14)`}>
          <rect x="-7" y="-40" width="14" height="28" rx="6" fill="var(--fun-shirt)" />
          <rect x="-7" y="-40" width="5" height="28" rx="3" fill={shine} />
          <circle cx="0" cy="-48" r="8" fill="var(--fun-skin)" />
          <path d="M-8 -49 A8 8 0 0 1 8 -50 Q2 -54 -8 -49 Z" fill="var(--fun-wood-dark)" />
        </g>
        <g stroke="var(--fun-skin)" strokeWidth="4" strokeLinecap="round" fill="none">
          {hands.map(([hx, hy], i) => (
            <path key={i} d={`M${sx} ${sy} Q${(sx + hx) / 2} ${(sy + hy) / 2 + 4} ${hx} ${hy}`} />
          ))}
        </g>
      </g>
    </g>
  );
}

function Ball({ x = 0, y = 0, r = 9, spin = 0 }: { x?: number; y?: number; r?: number; spin?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${spin})`}>
      <circle r={r} fill="var(--success)" />
      <path d={`M${-r * 0.9} ${-r * 0.3} Q0 ${r * 0.4} ${r * 0.9} ${-r * 0.3}`} fill="none" stroke="var(--fun-cloud)" strokeWidth={r / 5} />
      <circle cx={-r * 0.35} cy={-r * 0.35} r={r * 0.3} fill={shine} />
    </g>
  );
}

function Newspaper({ x, y, angle = -12 }: { x: number; y: number; angle?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <rect x="-11" y="-7" width="22" height="13" rx="1.5" fill="var(--fun-paper)" stroke="var(--fun-ink)" strokeWidth="0.8" />
      <line x1="-8" y1="-3" x2="7" y2="-3" stroke="var(--accent)" strokeWidth="1.8" />
      <line x1="-8" y1="1" x2="3" y2="1" stroke="var(--fun-ink)" strokeWidth="1.5" opacity="0.6" />
    </g>
  );
}

/** The dog, standing on the ground at `x`. `dir` 1 faces right; `roll` tumbles it (degrees). */
function Dog({ x, dir, running, t, carry, roll = 0, sad = false }: { x: number; dir: number; running: boolean; t: number; carry: "ball" | "news" | null; roll?: number; sad?: boolean }) {
  const stride = running ? Math.sin(t * 24) * 7 : 0;
  const bob = running ? -Math.abs(Math.sin(t * 24)) * 3 : Math.sin(t * 3) * 0.6;
  const fur = "var(--modified)";
  const wag = sad ? 2 : Math.sin(t * (running ? 20 : 12)) * 5;
  return (
    <g transform={`translate(${x} 200)`}>
      <ellipse cx="0" cy="1" rx="20" ry="2.5" fill={shade} />
      <g transform={`translate(0 ${bob}) scale(${dir} 1) rotate(${roll + (running ? Math.sin(t * 24) * 3 : 0)} 0 -20)`}>
        <path d={`M-17 -24 Q-26 -30 -28 ${(sad ? -16 : -38) + wag}`} fill="none" stroke={fur} strokeWidth="4" strokeLinecap="round" />
        {[-12, -6, 8, 14].map((lx, i) => (
          <line key={i} x1={lx} y1="-16" x2={lx + (i % 2 ? stride : -stride)} y2="0" stroke={i % 2 ? "var(--fun-wood)" : fur} strokeWidth="4" strokeLinecap="round" />
        ))}
        <ellipse cx="0" cy="-21" rx="20" ry="10" fill={fur} />
        <ellipse cx="-2" cy="-17" rx="14" ry="4.5" fill={shine} />
        <g transform={sad ? "rotate(18 12 -26)" : undefined}>
          <circle cx="18" cy="-32" r="9" fill={fur} />
          <ellipse cx="27" cy="-29" rx="7" ry="4.5" fill={fur} />
          <ellipse cx="27" cy="-27.5" rx="6" ry="2.5" fill={shine} />
          <circle cx="33" cy="-30.5" r="2" fill="var(--fun-pants)" />
          {sad ? <path d="M17 -34 Q20 -32 23 -34" fill="none" stroke="var(--fun-pants)" strokeWidth="1.5" /> : <circle cx="20" cy="-34" r="1.6" fill="var(--fun-pants)" />}
          <path d={`M12 -38 Q6 ${sad ? -26 : -30 + (running ? Math.sin(t * 24) * 3 : 0)} ${sad ? 9 : 11} ${sad ? -20 : -24}`} fill="none" stroke="var(--fun-wood-dark)" strokeWidth="5" strokeLinecap="round" />
          {carry === "ball" && <Ball x={34} y={-25} r={5} />}
          {carry === "news" && <Newspaper x={37} y={-25} />}
        </g>
        <rect x="9" y="-27" width="7" height="3.5" rx="1.5" fill="var(--danger)" transform="rotate(-60 12 -25)" />
      </g>
    </g>
  );
}

// Fetch: the ball flies for FLIGHT s, the dog runs at DOG px/s and starts after a moment.
const FLIGHT = 0.75;
const DOG = 300;
const DOG_HOME = 122;
const FAR = 0.72;
const HAND: [number, number] = [86, 146];
const landing = (power: number) => Math.min(372, 128 + power * 270);

/** Where everything is `e` seconds after a throw. */
export function fetchTimeline(power: number, e: number) {
  const land = landing(power);
  const stop = land - 30;
  const dist = Math.max(0, stop - DOG_HOME);
  const arrive = 0.15 + dist / DOG;
  const pick = Math.max(FLIGHT + 0.1, arrive) + 0.3;
  const back = pick + dist / DOG + 0.2;
  const u = clamp(e / FLIGHT);
  // A bounce after landing, until the dog picks it up.
  const after = Math.max(0, e - FLIGHT);
  const bounce = Math.abs(Math.sin(after * 9)) * 14 * Math.exp(-after * 5);
  const ball: [number, number] | null =
    e < pick ? (e < FLIGHT ? [lerp(HAND[0], land, u), lerp(HAND[1], 191, u) - Math.sin(Math.PI * u) * (40 + power * 80)] : [land + after * 10, 191 - bounce]) : null;
  const dogX = e < pick ? Math.min(stop, DOG_HOME + Math.max(0, e - 0.15) * DOG) : Math.max(DOG_HOME, stop - (e - pick) * DOG);
  const running = (e > 0.15 && e < arrive) || (e >= pick && dogX > DOG_HOME);
  return { land, ball, dogX, returning: e >= pick, running, back, far: power >= FAR };
}

/** The push car's rest position after rolling back `e` seconds from progress `from`. */
export function rollBack(from: number, e: number): number {
  const u = clamp(e / (0.4 + from * 0.7));
  return from * (1 - u * u);
}

const PUSH_FROM: [number, number] = [74, 190];
const PUSH_TO: [number, number] = [316, 79];

const SCENES: Record<FunKind, Scene> = {
  pull: {
    title: "Haul in the commits",
    hint: "Drag the rope down to lift the crate out of the remote.",
    skip: "Just pull",
    retry: "The crate slid back down. Pull the rope all the way.",
    working: "Holding on… pulling.",
    failed: "Snap! The rope broke: the pull failed. The error message says why.",
    done: (info) => (info.count ? `Hauled in ${plural(info.count, "commit")}!` : "Hauled in. You're up to date!"),
    from: [214, 116],
    to: [214, 182],
    pos: ({ lost }) => (lost == null ? null : [214 - clamp(lost / 0.3) * 18, Math.min(200, 182 + drop(lost, 500))]),
    draw: ({ p, t, dragging, end, won, lost, info }) => {
      const top = lost != null ? Math.min(196, 76 + drop(lost)) : lerp(196, 76, p);
      const grip = lost != null ? Math.min(200, 182 + drop(lost, 500)) : lerp(116, 182, p);
      const n = shown(info, 5);
      const sway = dragging || end != null ? 0 : Math.sin(t * 2.2) * 1.5;
      const swing = dragging || (end != null && won == null && lost == null) ? Math.sin(t * 8) * 1.2 : 0;
      const fell = lost != null ? clamp(lost / 0.35) : 0;
      const landed = lost != null ? lost - Math.sqrt((2 * 120) / 700) : -1;
      return (
        <>
          <Backdrop t={t} />
          <rect x="0" y="206" width="400" height="34" fill="var(--fun-ground)" />
          <rect x="0" y="206" width="400" height="3" fill={shine} />
          {/* The remote's pit. */}
          <rect x="204" y="206" width="84" height="34" fill={shade} />
          <rect x="204" y="206" width="84" height="34" fill={shade} />
          <rect x="198" y="203" width="8" height="8" rx="2" fill="var(--surface-3)" />
          <rect x="286" y="203" width="8" height="8" rx="2" fill="var(--surface-3)" />
          <text x="246" y="234" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--fun-cloud)">
            origin
          </text>
          {/* Gantry. */}
          <rect x="166" y="16" width="8" height="190" fill="var(--fun-wood)" />
          <rect x="316" y="16" width="8" height="190" fill="var(--fun-wood)" />
          <rect x="166" y="16" width="4" height="190" fill={shine} />
          <rect x="158" y="10" width="174" height="12" rx="3" fill="var(--fun-wood)" />
          <rect x="158" y="18" width="174" height="4" rx="2" fill="var(--fun-wood-dark)" />
          <line x1="230" y1="22" x2="230" y2="32" stroke={ink} strokeWidth="4" />
          {/* Local branch, drawn on the ground. */}
          <line x1="16" y1="226" x2="150" y2="226" stroke="var(--fun-cloud)" strokeWidth="2.5" strokeLinecap="round" />
          <text x="16" y="220" fontSize="10" fontWeight="600" fill="var(--fun-cloud)">
            main
          </text>
          {[36, 56, 76].map((cx) => (
            <circle key={cx} cx={cx} cy="226" r="5" fill="var(--fun-ground)" stroke="var(--fun-cloud)" strokeWidth="2.5" />
          ))}
          {/* Ropes. After a snap: a frayed stub at the pulley, a loose end on the crate, a slack pull rope. */}
          {lost == null ? (
            <>
              <path d={`M214 46 Q${214 + sway * 3} ${lerp(46, grip, 0.5)} ${214 + sway} ${grip}`} fill="none" stroke="var(--modified)" strokeWidth="4" strokeDasharray="6 2" strokeDashoffset={-p * 90} />
              <line x1="246" y1="46" x2={246 + swing} y2={top} stroke="var(--modified)" strokeWidth="4" strokeDasharray="6 2" strokeDashoffset={p * 90} />
            </>
          ) : (
            <>
              <path d={`M214 46 Q${190 - fell * 10} ${lerp(46, grip, 0.6)} ${214 - fell * 18} ${grip}`} fill="none" stroke="var(--modified)" strokeWidth="4" strokeDasharray="6 2" />
              <path d={`M246 46 L246 ${62 - fell * 6} M246 ${62 - fell * 6} l-4 6 M246 ${62 - fell * 6} l4 7`} fill="none" stroke="var(--modified)" strokeWidth="3" strokeLinecap="round" />
              <path d={`M246 ${top} Q${252 + fell * 10} ${top - 20} ${244 + fell * 14} ${top - 34 + fell * 10}`} fill="none" stroke="var(--modified)" strokeWidth="4" strokeDasharray="6 2" />
            </>
          )}
          <g transform={`rotate(${p * 600 + (lost ?? 0) * 900} 230 46)`}>
            <circle cx="230" cy="46" r="17" fill="var(--surface)" stroke={ink} strokeWidth="3" />
            {[0, 60, 120].map((a) => (
              <line key={a} x1="230" y1="32" x2="230" y2="60" stroke={ink} strokeWidth="2" transform={`rotate(${a} 230 46)`} />
            ))}
            <circle cx="230" cy="46" r="4" fill={ink} />
          </g>
          {/* The crate of commits. */}
          <g transform={`translate(${214 + swing} ${top}) rotate(${swing + (lost != null ? clamp(lost / 0.5) * 9 : 0)} 32 20)`}>
            <ellipse cx="32" cy="44" rx={28 - p * 10} ry="3" fill={shade} opacity={lost != null ? 0 : 1 - p} />
            <rect width="64" height="40" rx="3" fill="var(--fun-wood)" />
            <rect y="0" width="64" height="5" rx="2" fill="var(--fun-wood-dark)" />
            <rect y="35" width="64" height="5" rx="2" fill="var(--fun-wood-dark)" />
            <path d="M3 37 L61 3" stroke="var(--fun-wood-dark)" strokeWidth="3" />
            <rect x="10" y="11" width="44" height="19" rx="3" fill="var(--surface)" />
            {won == null && Array.from({ length: n }, (_, i) => <circle key={i} cx={32 + (i - (n - 1) / 2) * 9} cy="-4" r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />)}
            <text x="32" y="24.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--accent-text)">
              {info.count ? `${info.count} new` : "commits"}
            </text>
          </g>
          {/* The person hauling: leaning back more as the rope comes down; thrown over when it snaps. */}
          <Person x={186} y={206} lean={-6 - p * 14} fall={-fell * 82} hands={[[26, grip - 206 + 4], [26, grip - 206 + 14]]} step={dragging ? Math.sin(t * 10) * 0.3 : 0} />
          {lost != null && lost < 0.7 && <Bubble x={270} y={66} text="SNAP!" tone="var(--danger)" />}
          {lost != null && <Dust x={246} y={206} e={landed} />}
          {lost != null && lost > 0.6 && <Bubble x={150} y={150} text="Oof" tone="var(--text-muted)" />}
          {won != null &&
            Array.from({ length: n }, (_, i) => {
              const k = clamp((won - i * 0.09) / 0.5);
              if (k <= 0) return null;
              const x = lerp(246, 98 + i * 16, k);
              const y = lerp(top - 4, 226, k) - Math.sin(Math.PI * k) * 50;
              return <circle key={i} cx={x} cy={y} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />;
            })}
          {won != null && <Burst x={120} y={220} e={Math.max(0, won - 0.5)} n={16} />}
        </>
      );
    },
    handle: ({ p, t, dragging, end }) => (
      <g>
        <rect x="-8" y="-2" width="16" height="26" rx="6" fill="var(--accent)" />
        <rect x="-8" y="-2" width="6" height="26" rx="3" fill={shine} />
        {p === 0 && !dragging && end == null && (
          <path d={`M-7 ${34 + Math.sin(t * 5) * 4} l7 7 l7 -7`} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </g>
    ),
  },
  push: {
    title: "Push the car up the hill",
    hint: "Drag the car to the top so your commits reach the remote. It's heavy: it follows slowly, and rolls back if you let go.",
    skip: "Just push",
    retry: "It rolled back down. Push it all the way to the top.",
    working: "At the top… knocking on the remote's door.",
    failed: "The remote turned it away and the car rolled back: the push failed. The error message says why.",
    done: (info) => (info.count ? `Delivered ${plural(info.count, "commit")} to the remote!` : "Delivered to the remote!"),
    from: PUSH_FROM,
    to: PUSH_TO,
    draw: ({ t, end, won, lost, back }) => {
      const wave = (k: number) => Math.sin(t * 6 + k) * 3;
      const top = won != null ? 2 : lost != null ? 24 : 12;
      const waiting = end != null && won == null && lost == null;
      const led = (i: number) =>
        won != null ? "var(--success)" : lost != null ? "var(--danger)" : (Math.floor(t * (waiting ? 12 : 3)) + i) % 3 === 0 ? "var(--success)" : "var(--border-strong)";
      // Where the pusher fell: at the spot the car started rolling back from.
      const fallAt = back ? [lerp(PUSH_FROM[0], PUSH_TO[0], back.from), lerp(PUSH_FROM[1], PUSH_TO[1], back.from)] : null;
      const fell = back ? clamp(back.e / 0.35) : 0;
      return (
        <>
          <Backdrop t={t} sun={[56, 40]} />
          <path d="M0 215 L20 215 L330 72 L400 72 L400 240 L0 240 Z" fill="var(--fun-ground)" />
          <path d="M0 215 L20 215 L330 72 L400 72" fill="none" stroke={shine} strokeWidth="3" />
          <path d="M28 222 L334 81" stroke={shade} strokeWidth="2" strokeDasharray="10 8" />
          {[80, 150, 230].map((x) => (
            <path key={x} d={`M${x} ${215 - ((x - 20) * 143) / 310 + 12} l3 -6 l3 6 l3 -4`} fill="none" stroke={shine} strokeWidth="1.5" />
          ))}
          {/* The remote: a server with a flag. */}
          <ellipse cx="362" cy="73" rx="24" ry="3" fill={shade} />
          <rect x="342" y="32" width="40" height="40" rx="4" fill="var(--surface)" stroke={lost != null ? "var(--danger)" : ink} strokeWidth="2" />
          {[42, 52, 62].map((y, i) => (
            <g key={y}>
              <rect x="348" y={y - 2} width="22" height="4" rx="2" fill="var(--surface-3)" />
              <circle cx="375" cy={y} r="2.2" fill={led(i)} />
            </g>
          ))}
          <line x1="362" y1="32" x2="362" y2={top} stroke={ink} strokeWidth="2" />
          <path
            d={`M362 ${top} Q374 ${top + wave(0)} 386 ${top + 2 + wave(1)} L386 ${top + 12 + wave(2)} Q374 ${top + 10 + wave(1)} 362 ${top + 10} Z`}
            fill={lost != null ? "var(--danger)" : "var(--success)"}
          />
          <text x="362" y="92" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--fun-cloud)">
            origin
          </text>
          {waiting && <Bubble x={330} y={44} text={".".repeat(1 + (Math.floor(t * 3) % 3))} />}
          {lost != null && lost < 1.4 && <Bubble x={322} y={44} text="Rejected" tone="var(--danger)" />}
          {fallAt && (
            <g transform={`translate(${fallAt[0]} ${fallAt[1]}) rotate(-24.8)`}>
              <Person x={-46} y={0} lean={30 * (1 - fell)} fall={-fell * 84} hands={[[16 - fell * 20, -24 + fell * 10], [12 - fell * 26, -16]]} />
              {back && back.e > 0.4 && back.e < 1.8 && <Bubble x={-60} y={-46} text="Whoa!" tone="var(--text-muted)" />}
            </g>
          )}
          {back && <Dust x={34} y={214} e={back.e - (0.4 + back.from * 0.7)} />}
          {won != null && (
            <>
              <Burst x={362} y={30} e={won} />
              <text x="330" y={34 - won * 22} textAnchor="end" fontSize="13" fontWeight="700" fill="var(--success)" opacity={clamp(1.4 - won)}>
                Pushed!
              </text>
            </>
          )}
        </>
      );
    },
    handle: ({ p, t, moving, dragging, won, back, info }) => {
      // Wheels turn with the distance travelled: about 270 px of slope over 7.5 px wheels.
      const spin = p * 2200;
      const walk = Math.sin(p * 60);
      const n = won == null ? shown(info, 3) : 0;
      const strain = dragging ? Math.sin(t * 30) * 0.6 : 0;
      return (
        // Tilted to sit on the slope (about −24.8°).
        <g transform="rotate(-24.8)">
          <ellipse cx="-4" cy="1" rx="34" ry="3" fill={shade} />
          {/* The person pushing, behind the car, walking as it moves (drawn fallen in the scene instead). */}
          {!back && <Person x={-46} y={0} lean={30 + strain} hands={[[24, -24], [22, -18]]} step={walk} />}
          {(moving || back) && (
            <g fill="var(--fun-cloud)">
              {[0, 1, 2].map((i) => {
                const k = (t * 2 + i / 3) % 1;
                const dx = back ? 30 + k * 26 : -30 - k * 26;
                return <circle key={i} cx={dx} cy={-6 - k * 10} r={2 + k * 4} opacity={0.8 - k * 0.8} />;
              })}
            </g>
          )}
          {/* Cargo: the commits being pushed. */}
          {Array.from({ length: n }, (_, i) => (
            <g key={i} transform={`translate(${-17 + i * 12} -44)`}>
              <rect width="11" height="11" rx="2" fill="var(--fun-wood)" />
              <rect y="4.5" width="11" height="2" fill="var(--fun-wood-dark)" />
            </g>
          ))}
          {n > 0 && <rect x="-20" y="-34" width="40" height="3" rx="1.5" fill={ink} />}
          <path d="M-30 -9 Q-31 -20 -22 -21 L-14 -22 L-8 -31 Q-6 -33 -2 -33 L12 -33 Q16 -33 18 -30 L23 -22 L27 -21 Q32 -20 31 -12 L31 -9 Z" fill="var(--accent)" />
          <path d="M-6 -30 L-11 -23 L3 -23 L3 -30 Z" fill="var(--fun-sky)" />
          <path d="M6 -30 L6 -23 L20 -23 L16 -30 Z" fill="var(--fun-sky)" />
          <path d="M-4 -29 L-7 -25 L-4 -25 L-1 -29 Z" fill={shine} />
          <rect x="-26" y="-19" width="52" height="2.5" rx="1" fill={shine} />
          <circle cx="29" cy="-16" r="2.4" fill="var(--fun-sun)" />
          <rect x="-31" y="-18" width="3" height="4" rx="1" fill="var(--danger)" />
          {[-17, 17].map((cx) => (
            <g key={cx} transform={`translate(${cx} -7) rotate(${spin})`}>
              <circle r="7.5" fill="var(--fun-pants)" />
              <circle r="4" fill="var(--surface-3)" />
              {[0, 72, 144, 216, 288].map((a) => (
                <line key={a} x1="0" y1="0" x2="0" y2="-3.6" stroke="var(--fun-pants)" strokeWidth="1.3" transform={`rotate(${a})`} />
              ))}
              <circle r="1.3" fill="var(--fun-pants)" />
            </g>
          ))}
        </g>
      );
    },
  },
  fetch: {
    title: "Throw the ball",
    hint: "Pull the ball back and let go. Reach the kennel and the dog brings back what's new.",
    skip: "Just fetch",
    retry: "Too short! The remote is by the kennel. Pull back further.",
    working: "Good dog… reading the news from the remote.",
    failed: "The dog tripped and the news blew away: the fetch failed. The error message says why.",
    done: () => "Good dog! Fetched the latest from the remote.",
    from: HAND,
    to: [40, 172],
    pos: ({ thr }) => (thr ? (fetchTimeline(thr.power, thr.e).ball ?? [-50, -50]) : null),
    draw: ({ p, t, thr, end, won, lost }) => {
      const tl = thr ? fetchTimeline(thr.power, thr.e) : null;
      // The throwing arm: wound back while aiming, swung forward for a moment after the throw.
      const follow = thr ? clamp(thr.e / 0.15) : end != null ? 1 : 0;
      const hand: [number, number] = thr || end != null ? [lerp(28, 34, follow), lerp(-62, -50, follow)] : [lerp(HAND[0], 40, p) - 66, lerp(HAND[1], 172, p) - 200];
      const trip = lost != null ? clamp(lost / 0.45) : 0;
      return (
        <>
          <Backdrop t={t} sun={[330, 42]} />
          {/* A tree for depth. */}
          <rect x="238" y="150" width="7" height="52" fill="var(--fun-wood-dark)" />
          <circle cx="241" cy="140" r="20" fill="var(--fun-hill)" />
          <circle cx="228" cy="152" r="13" fill="var(--fun-hill)" />
          <circle cx="255" cy="150" r="14" fill="var(--fun-hill)" />
          <circle cx="234" cy="134" r="8" fill={shine} />
          <rect x="0" y="200" width="400" height="40" fill="var(--fun-ground)" />
          <rect x="0" y="200" width="400" height="3" fill={shine} />
          {[160, 200, 290, 312].map((gx) => (
            <path key={gx} d={`M${gx} 201 l2 -7 l2 7 l2 -5 l2 5`} fill="none" stroke="var(--fun-hill)" strokeWidth="1.6" />
          ))}
          {/* Kennel: the remote. */}
          <ellipse cx="355" cy="201" rx="30" ry="3" fill={shade} />
          <rect x="330" y="170" width="50" height="31" fill="var(--fun-wood)" />
          <rect x="330" y="178" width="50" height="2" fill="var(--fun-wood-dark)" />
          <rect x="330" y="188" width="50" height="2" fill="var(--fun-wood-dark)" />
          <path d="M322 172 L355 146 L388 172 Z" fill="var(--danger)" />
          <path d="M322 172 L355 146 L355 151 L327 173 Z" fill={shine} />
          <path d="M345 201 L345 187 A10 10 0 0 1 365 187 L365 201 Z" fill="var(--fun-pants)" />
          <rect x="341" y="158" width="28" height="10" rx="2" fill="var(--surface)" />
          <text x="355" y="166" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="var(--text)">
            origin
          </text>
          {/* Aim: the arc the ball will take, and where it lands. */}
          {!thr && end == null && p > 0.05 && (
            <g>
              {Array.from({ length: 11 }, (_, i) => {
                const u = (i + 1) / 12;
                return <circle key={i} cx={lerp(HAND[0], landing(p), u)} cy={lerp(HAND[1], 191, u) - Math.sin(Math.PI * u) * (40 + p * 80)} r="2" fill="var(--fun-cloud)" opacity={1 - u * 0.5} />;
              })}
              <ellipse cx={landing(p)} cy="201" rx="10" ry="3" fill="none" stroke={p >= FAR ? "var(--success)" : "var(--fun-cloud)"} strokeWidth="2" />
            </g>
          )}
          <Person x={66} y={200} lean={thr || end != null ? lerp(-12, 10, follow) : -p * 14} fall={lost != null ? -clamp((lost - 0.25) / 0.35) * 80 : 0} hands={[hand, [-10, -30]]} />
          {tl && thr ? (
            <>
              <Dog x={tl.dogX} dir={tl.returning ? -1 : 1} running={tl.running} t={t} carry={tl.returning ? (tl.far ? "news" : "ball") : null} />
              {thr.e < 0.7 && (
                <text x={DOG_HOME + 26} y={158 - thr.e * 20} fontSize="12" fontWeight="800" fill="var(--modified)" opacity={1 - thr.e / 0.7}>
                  Woof!
                </text>
              )}
            </>
          ) : (
            <Dog
              x={DOG_HOME + (lost != null ? trip * 22 : 0)}
              dir={1}
              running={false}
              t={t}
              roll={trip * 360}
              sad={lost != null && lost > 0.5}
              carry={end != null && lost == null ? "news" : null}
            />
          )}
          {/* Failure: the news flies off in the wind. */}
          {lost != null && <Newspaper x={DOG_HOME + 37 + lost * 140} y={175 - lost * 70 + drop(lost, 40)} angle={lost * 500} />}
          {lost != null && lost > 0.6 && <Bubble x={DOG_HOME + 30} y={150} text="?" tone="var(--text-muted)" />}
          {end != null && won == null && lost == null && <Bubble x={DOG_HOME + 40} y={150} text="Woof" tone="var(--modified)" />}
          {won != null && <Burst x={DOG_HOME + 10} y={168} e={won} />}
        </>
      );
    },
    handle: ({ thr, end }) => {
      const hidden = (thr && fetchTimeline(thr.power, thr.e).ball == null) || end != null;
      const y = thr ? (fetchTimeline(thr.power, thr.e).ball?.[1] ?? 200) : 0;
      return (
        <g opacity={hidden ? 0 : 1}>
          {thr && <ellipse cx="0" rx={9 * (0.4 + (y / 200) * 0.6)} ry="2.5" cy={200 - y} fill={shade} />}
          <Ball spin={thr ? thr.e * 900 : 0} />
        </g>
      );
    },
  },
  commit: {
    title: "Stamp your commit",
    hint: "Drag the stamp down onto the page to seal this snapshot.",
    skip: "Just commit",
    retry: "The stamp bounced back up. Press it all the way onto the page.",
    working: "Pressing down…",
    failed: "The ink smudged: the commit failed. The error message says why.",
    done: () => "Sealed! Your snapshot is saved.",
    from: [200, 46],
    to: [200, 142],
    pos: ({ won, lost }) => {
      if (won != null) {
        const lift = clamp(won / 0.35);
        return [200, 142 - lift * lift * 96];
      }
      if (lost != null) {
        // Lifts, slips sideways and lands on its side by the page.
        const k = clamp(lost / 0.6);
        return [lerp(200, 330, k), 142 - Math.sin(Math.PI * k) * 60 + k * -6];
      }
      return null;
    },
    draw: ({ p, t, end, won, lost, info }) => {
      const hit = end != null && won == null && lost == null ? end : null;
      const shake = (e: number | null) => (e != null && e < 0.3 ? Math.sin(e * 90) * 3 * (1 - e / 0.3) : 0);
      const text = (info.label ?? "").trim() || "Snapshot";
      const label = text.length > 28 ? `${text.slice(0, 27)}…` : text;
      return (
        <>
          <rect width="400" height="240" fill="var(--fun-sky)" />
          {/* A window behind the desk. */}
          <rect x="300" y="24" width="72" height="62" rx="4" fill="var(--fun-hill-far)" />
          <line x1="336" y1="24" x2="336" y2="86" stroke="var(--fun-sky)" strokeWidth="3" />
          <line x1="300" y1="55" x2="372" y2="55" stroke="var(--fun-sky)" strokeWidth="3" />
          <Cloud t={t} y={46} offset={300} speed={0} size={0.6} />
          <g transform={`translate(${shake(hit) + shake(lost)} 0)`}>
            <rect x="0" y="138" width="400" height="102" fill="var(--fun-wood)" />
            <rect x="0" y="138" width="400" height="4" fill={shine} />
            {[164, 196, 226].map((y) => (
              <path key={y} d={`M0 ${y} Q100 ${y - 4} 200 ${y} T400 ${y}`} fill="none" stroke="var(--fun-wood-dark)" strokeWidth="1.5" opacity="0.5" />
            ))}
            {/* Ink pad. */}
            <rect x="24" y="176" width="58" height="26" rx="4" fill="var(--fun-pants)" />
            <rect x="29" y="180" width="48" height="17" rx="3" fill="var(--danger)" opacity="0.85" />
            {/* The page, with this commit's summary. */}
            <g transform="rotate(-2 200 190)">
              <rect x="92" y="152" width="220" height="82" rx="2" fill={shade} transform="translate(3 3)" />
              <path d="M90 150 L294 150 L310 166 L310 232 L90 232 Z" fill="var(--fun-paper)" />
              <path d="M294 150 L294 166 L310 166 Z" fill={shade} />
              <text x="104" y="172" fontSize="11.5" fontFamily="var(--font-mono)" fill="var(--fun-ink)">
                {label}
              </text>
              <rect x="104" y="184" width="184" height="3" rx="1.5" fill={shade} />
              <rect x="104" y="196" width="150" height="3" rx="1.5" fill={shade} />
              <rect x="104" y="208" width="120" height="3" rx="1.5" fill={shade} />
              {end == null && <ellipse cx="200" cy="196" rx={8 + p * 26} ry={2 + p * 6} fill={shade} opacity={0.3 + p * 0.7} />}
              {(won != null || lost != null) && (
                <g transform={lost != null ? "rotate(5 200 196) skewX(-8)" : "rotate(-8 200 196)"} opacity={clamp((won ?? lost ?? 0) * 8) * (lost != null ? 0.8 : 1)}>
                  <rect x="132" y="181" width="136" height="30" rx="5" fill="none" stroke="var(--danger)" strokeWidth="3" strokeDasharray={lost != null ? "14 5 3 6" : undefined} />
                  <text x="200" y="202" textAnchor="middle" fontSize="16" fontWeight="800" letterSpacing="2.5" fill="var(--danger)">
                    {lost != null ? "FAILED" : "COMMITTED"}
                  </text>
                  {Array.from({ length: lost != null ? 14 : 8 }, (_, i) => (
                    <circle key={i} cx={128 + ((i * 53) % 145)} cy={176 + ((i * 29) % 42)} r={0.8 + (i % 3) * (lost != null ? 1.4 : 0.8)} fill="var(--danger)" opacity="0.75" />
                  ))}
                  {lost != null && <path d="M140 210 Q170 190 200 205 T262 186" fill="none" stroke="var(--danger)" strokeWidth="5" strokeLinecap="round" opacity="0.6" />}
                </g>
              )}
            </g>
            {won != null && <Burst x={200} y={170} e={won} n={14} />}
            {lost != null && lost > 0.5 && <Bubble x={200} y={130} text="Oops" tone="var(--danger)" />}
          </g>
        </>
      );
    },
    handle: ({ end, won, lost }) => {
      const pressing = end != null && won == null && lost == null;
      const squash = pressing ? 0.84 : 1;
      const tip = lost != null ? clamp(lost / 0.6) * 95 : 0;
      return (
        <g transform={`rotate(${tip} 0 8) translate(0 46) scale(1 ${squash}) translate(0 -46)`}>
          <circle cx="0" cy="-42" r="12" fill="var(--fun-wood)" />
          <circle cx="-4" cy="-46" r="4" fill={shine} />
          <path d="M-5 -32 L5 -32 L7 -14 L-7 -14 Z" fill="var(--fun-wood)" />
          <rect x="-5" y="-32" width="3" height="18" fill={shine} />
          <rect x="-32" y="-15" width="64" height="15" rx="3" fill="var(--fun-wood-dark)" />
          <rect x="-32" y="-15" width="64" height="4" rx="2" fill={shine} />
          <rect x="-30" y="0" width="60" height="7" rx="1.5" fill="var(--danger)" />
        </g>
      );
    },
  },
};

/** Keyboard focus ring around each handle: centre and radius in the handle's coordinates. */
const RING: Record<FunKind, [number, number, number]> = { pull: [0, 11, 20], push: [-10, -22, 46], fetch: [0, 0, 15], commit: [0, -18, 38] };

const DONE = 0.97;
/** The end pose shows for at least this long before the result plays (ms). */
const HOLD_MS = 600;
const WON_MS = 1300;
const LOST_MS = 2600;
const QUICK_MS = 350;
/** How fast the heavy car can follow the hand, in progress per second. */
const CAR_SPEED = 0.42;

/** Projects a drag onto the line `from → to` and returns progress 0…1. */
export function progressAlong(from: [number, number], to: [number, number], start: number, dx: number, dy: number): number {
  const ax = to[0] - from[0];
  const ay = to[1] - from[1];
  return clamp(start + (dx * ax + dy * ay) / (ax * ax + ay * ay));
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Seconds since `active` became true, updated every animation frame. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const start = performance.now();
    const tick = (n: number) => {
      setNow(Math.max(0, (n - start) / 1000));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active]);
  return active ? now : 0;
}

const COUNTS_KEY = "gitpilot.funCounts";
/** Counts finished scenes per kind, for "your 5th push". Best effort: storage can be unavailable. */
function bumpCount(kind: FunKind): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(COUNTS_KEY) ?? "{}") as Partial<Record<FunKind, number>>;
    const next = (all[kind] ?? 0) + 1;
    localStorage.setItem(COUNTS_KEY, JSON.stringify({ ...all, [kind]: next }));
    return next;
  } catch {
    return null;
  }
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

interface FunGateProps {
  kind: FunKind | null;
  info?: FunInfo;
  /** Runs the Git operation once the task is done (see FunAction). */
  action: FunAction;
  /** The scene is over (after the success or failure animation). */
  onClose: () => void;
  /** The skip button: run the operation straight away, without the scene. */
  onSkip: () => void;
  onCancel: () => void;
}

/** Fun mode: a small physical task before a Git action, then the real result. Never blocks: there's always a skip button. */
export function FunGate({ kind, info, action, onClose, onSkip, onCancel }: FunGateProps) {
  const scene = kind ? SCENES[kind] : null;
  const [reduce] = useState(reducedMotion);
  const t = useClock(!!scene && !reduce);
  // `p` is where the hand is; `car` is where the (heavy) push car has got to.
  const [p, setP] = useState(0);
  const [car, setCar] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; at: number } | null>(null);
  const [thr, setThr] = useState<Throw | null>(null);
  const [spring, setSpring] = useState<{ from: number; at: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; start: number; scale: number } | null>(null);
  const finished = useRef(false);
  const clock = useRef(0);
  const lastT = useRef(0);
  const timers = useRef<number[]>([]);
  clock.current = t;
  const heavy = kind === "push" && !reduce;

  useEffect(() => {
    setP(0);
    setCar(0);
    setMessage(null);
    setEndAt(null);
    setResult(null);
    setThr(null);
    setSpring(null);
    finished.current = false;
  }, [kind]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const count = info?.count;
  const finish = useCallback(() => {
    if (finished.current || !kind) return;
    finished.current = true;
    const started = performance.now();
    setP(1);
    setCar(1);
    setSpring(null);
    setThr(null);
    setEndAt(clock.current);
    setMessage(SCENES[kind].working);
    let out: unknown;
    try {
      out = action();
    } catch {
      out = false;
    }
    const settle = (ok: boolean) => {
      const show = () => {
        setResult({ ok, at: clock.current });
        if (ok) {
          const n = bumpCount(kind);
          const text = SCENES[kind].done({ count });
          setMessage(n && n > 1 ? `${text} That's your ${ordinal(n)} ${kind} in fun mode.` : text);
        } else setMessage(SCENES[kind].failed);
        later(onClose, reduce ? QUICK_MS : ok ? WON_MS : LOST_MS);
      };
      const wait = reduce ? 0 : HOLD_MS - (performance.now() - started);
      if (wait > 0) later(show, wait);
      else show();
    };
    Promise.resolve(out).then(
      (v) => settle(v !== false),
      () => settle(false),
    );
  }, [kind, count, action, onClose, reduce]);

  // The car creeps towards the hand at CAR_SPEED; it reaching the top is what counts.
  useEffect(() => {
    const dt = Math.min(0.05, Math.max(0, t - lastT.current));
    lastT.current = t;
    if (!heavy || spring || finished.current) return;
    if (car !== p) setCar((c) => (Math.abs(p - c) <= CAR_SPEED * dt ? p : c + Math.sign(p - c) * CAR_SPEED * dt));
    if (car >= DONE) finish();
  }, [t, heavy, spring, car, p, finish]);

  // Let go early: the handle springs (or rolls) back to the start.
  const springDone = spring ? (kind === "push" ? rollBack(spring.from, t - spring.at) === 0 && t - spring.at > 0.4 + spring.from * 0.7 + 0.9 : t - spring.at >= 0.45) : false;
  useEffect(() => {
    if (spring && springDone) {
      setSpring(null);
      setP(0);
      setCar(0);
    }
  }, [spring, springDone]);

  // The fetch throw plays out on the clock; whether the dog brings news decides the result.
  const thrE = thr ? t - thr.at : 0;
  useEffect(() => {
    if (!thr) return;
    const tl = fetchTimeline(thr.power, thrE);
    if (reduce || thrE >= tl.back) {
      setThr(null);
      if (tl.far) finish();
      else {
        setP(0);
        setMessage(SCENES.fetch.retry);
      }
    }
  }, [thr, thrE, reduce, finish]);

  if (!scene || !kind) return <Dialog open={false} onClose={onCancel} title="" />;

  const since = (at: number | null) => (at == null ? null : reduce ? 2 : t - at);
  const won = result?.ok ? since(result.at) : null;
  const lost = result && !result.ok ? since(result.at) : null;
  const at = heavy ? car : p;
  let back: Frame["back"] = null;
  if (kind === "push" && spring && !reduce) back = { e: t - spring.at, from: spring.from };
  if (kind === "push" && lost != null) back = { e: lost, from: 1 };
  let shownP = at;
  if (back) shownP = rollBack(back.from, back.e);
  else if (spring) shownP = spring.from * (1 - clamp((t - spring.at) / 0.45)) ** 3;
  const frame: Frame = {
    p: shownP,
    t,
    dragging,
    moving: heavy && Math.abs(p - car) > 0.004 && !back,
    end: since(endAt),
    won,
    lost,
    info: info ?? {},
    thr: thr ? { e: thrE, power: thr.power } : null,
    back,
  };
  const [x, y] = scene.pos?.(frame) ?? [lerp(scene.from[0], scene.to[0], shownP), lerp(scene.from[1], scene.to[1], shownP)];
  const locked = endAt != null || !!thr || (kind === "push" && !!spring);

  const throwBall = (power: number) => {
    if (power < 0.08) {
      setP(0);
      return;
    }
    setMessage(null);
    setThr({ at: clock.current, power });
  };

  const release = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (kind === "fetch") throwBall(p);
    else if (at >= DONE) finish();
    else if (heavy && p >= DONE) return; // Hand at the top: the car keeps creeping up on its own.
    else if (at > 0.02) {
      setMessage(scene.retry);
      if (reduce) {
        setP(0);
        setCar(0);
      } else setSpring({ from: at, at: clock.current });
    } else {
      setP(0);
      setCar(0);
    }
  };

  let live = message;
  if (!live && heavy && dragging && p - car > 0.15) live = "Heavy! Keep pushing…";
  if (!live && dragging && p > 0.6) live = kind === "fetch" ? (p >= FAR ? "That'll reach the kennel. Let go!" : "Further…") : "Almost there…";
  if (!live && kind === "fetch" && !thr) live = "Drag the ball back (or use the arrow keys), then let go (Enter).";

  return (
    <Dialog
      open
      onClose={onCancel}
      width={560}
      title={scene.title}
      description={scene.hint}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {endAt != null ? "Close" : "Cancel"}
          </Button>
          <span className="flex-1" />
          <Button onClick={onSkip} disabled={endAt != null}>
            {scene.skip}
          </Button>
        </>
      }
    >
      <svg ref={svg} viewBox="0 0 400 240" className="w-full touch-none select-none overflow-hidden rounded-md border border-border" role="img" aria-label={scene.title}>
        <defs>
          <clipPath id="fun-frame">
            <rect width="400" height="240" />
          </clipPath>
        </defs>
        <g clipPath="url(#fun-frame)">
          {scene.draw(frame)}
          <g
            role="slider"
            tabIndex={0}
            aria-label={kind === "fetch" ? "Throw power" : scene.title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p * 100)}
            data-autofocus
            transform={`translate(${x} ${y})`}
            className={locked ? "group outline-none" : dragging ? "group cursor-grabbing outline-none" : "group cursor-grab outline-none"}
            onPointerDown={(e) => {
              if (locked) return;
              const r = svg.current?.getBoundingClientRect();
              setSpring(null);
              setMessage(null);
              drag.current = { x: e.clientX, y: e.clientY, start: shownP, scale: r && r.width ? 400 / r.width : 1 };
              setP(shownP);
              setCar(shownP);
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
              if (locked) return;
              const step = { ArrowDown: 0.1, ArrowRight: 0.1, ArrowUp: -0.1, ArrowLeft: -0.1 }[e.key];
              if (kind === "fetch") {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  throwBall(p);
                } else if (e.key === "End") {
                  e.preventDefault();
                  setP(1);
                  throwBall(1);
                } else if (step) {
                  e.preventDefault();
                  setMessage(null);
                  setP(clamp(Math.round((p + step) * 10) / 10));
                }
              } else if (e.key === "End" || ((e.key === "Enter" || e.key === " ") && at >= DONE)) {
                e.preventDefault();
                finish();
              } else if (step) {
                e.preventDefault();
                setSpring(null);
                const next = clamp(Math.round((p + step) * 10) / 10);
                setP(next);
                if (!heavy && next >= DONE) finish();
              }
            }}
          >
            {scene.handle(frame)}
            {!locked && !dragging && <circle cx={RING[kind][0]} cy={RING[kind][1]} r={RING[kind][2]} fill="none" stroke="var(--focus)" strokeWidth="2" strokeDasharray="5 4" className="opacity-0 group-focus-visible:opacity-100" />}
          </g>
        </g>
      </svg>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div
          className={lost != null ? "h-full bg-danger" : (kind === "fetch" && p >= FAR) || won != null ? "h-full bg-success" : "h-full bg-accent"}
          style={{ width: `${(kind === "fetch" && endAt == null ? p : shownP) * 100}%` }}
        />
      </div>
      <p className="mt-2 min-h-5 text-base text-muted" aria-live="polite">
        {live}
      </p>
    </Dialog>
  );
}

/**
 * Runs `run` right away, or after the fun-mode task when `settings.funMode` is on. With fun mode,
 * a `run` that resolves to `false` (the operation failed) plays the scene's failure.
 */
export function useFunGate() {
  const { settings } = useStore();
  const [pending, setPending] = useState<{ kind: FunKind; run: FunAction; info: FunInfo } | null>(null);
  const gate = useCallback(
    (kind: FunKind, run: FunAction, info: FunInfo = {}) => {
      if (settings?.funMode) setPending({ kind, run, info });
      else void run();
    },
    [settings?.funMode],
  );
  const run = pending?.run;
  const action = useCallback(() => run?.(), [run]);
  const close = useCallback(() => setPending(null), []);
  const element = (
    <FunGate
      kind={pending?.kind ?? null}
      info={pending?.info}
      action={action}
      onClose={close}
      onCancel={close}
      onSkip={() => {
        setPending(null);
        void run?.();
      }}
    />
  );
  return { gate, element };
}
