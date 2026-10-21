// Accent colours. "blue" is the classic GitPilot palette defined in tokens.css; every other
// preset (and any custom #rrggbb) is turned into the same set of tokens here, in OKLCH so
// lightness is perceptually even across hues.

export type AccentPreset = { id: string; label: string; hex: string };

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "blue", label: "Classic blue", hex: "#3550c8" },
  { id: "indigo", label: "Indigo", hex: "#4f46e5" },
  { id: "violet", label: "Violet", hex: "#7c3aed" },
  { id: "pink", label: "Pink", hex: "#db2777" },
  { id: "red", label: "Red", hex: "#dc2626" },
  { id: "orange", label: "Orange", hex: "#ea580c" },
  { id: "amber", label: "Amber", hex: "#d97706" },
  { id: "green", label: "Green", hex: "#16a34a" },
  { id: "teal", label: "Teal", hex: "#0d9488" },
  { id: "cyan", label: "Cyan", hex: "#0891b2" },
  { id: "slate", label: "Slate", hex: "#475569" },
];

export const ACCENT_TOKENS = ["--accent", "--accent-hover", "--accent-text", "--accent-soft", "--on-accent", "--focus", "--selection"] as const;
export type AccentTokens = Record<(typeof ACCENT_TOKENS)[number], string>;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(v: string): boolean {
  return HEX.test(v);
}

/** The hex colour an accent setting stands for (preset id or custom hex). */
export function accentHex(accent: string): string {
  return ACCENT_PRESETS.find((p) => p.id === accent)?.hex ?? (isHex(accent) ? accent.toLowerCase() : ACCENT_PRESETS[0]!.hex);
}

// ---------- colour math ----------

type Rgb = [number, number, number]; // 0..1 sRGB
type Lch = { l: number; c: number; h: number };

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const to = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function rgbToOklch(rgb: Rgb): Lch {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToLinear({ l: L, c, h }: Lch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → hex, lowering chroma until the colour fits in sRGB. */
function oklchToHex(lch: Lch): string {
  let c = lch.c;
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear({ ...lch, c });
    if (lin.every((x) => x >= -0.0005 && x <= 1.0005)) return rgbToHex(lin.map(toGamma) as Rgb);
    c *= 0.92;
  }
  return rgbToHex(oklchToLinear({ ...lch, c: 0 }).map(toGamma) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Derives the accent tokens for one theme from a base colour. */
export function deriveAccent(hex: string, theme: "light" | "dark"): AccentTokens {
  const base = rgbToOklch(hexToRgb(hex));
  const c = base.c;
  const h = base.h;
  const tone = (l: number, chroma = c) => oklchToHex({ l, c: chroma, h });

  if (theme === "light") {
    const l = clamp(base.l, 0.4, 0.62);
    const accent = tone(l);
    const white = contrast("#ffffff", accent) >= 3.6;
    return {
      "--accent": accent,
      "--accent-hover": tone(l - 0.06),
      "--accent-text": tone(Math.min(l, 0.5)),
      "--accent-soft": tone(0.955, Math.min(c, 0.03)),
      "--on-accent": white ? "#ffffff" : "#15171c",
      "--focus": accent,
      "--selection": tone(0.93, Math.min(c, 0.04)),
    };
  }
  const l = clamp(base.l, 0.56, 0.68);
  const accent = tone(l);
  const white = contrast("#ffffff", accent) >= 3.6;
  return {
    "--accent": accent,
    "--accent-hover": tone(l + 0.05),
    "--accent-text": tone(0.79, Math.min(c, 0.12)),
    "--accent-soft": tone(0.29, Math.min(c, 0.045)),
    "--on-accent": white ? "#ffffff" : "#15171c",
    "--focus": tone(0.74, Math.min(c, 0.14)),
    "--selection": tone(0.32, Math.min(c, 0.05)),
  };
}

/** Applies an accent to the document. The classic blue uses the stylesheet's own values. */
export function applyAccent(root: HTMLElement, accent: string, theme: "light" | "dark"): void {
  if (accent === "blue" || (!isHex(accent) && !ACCENT_PRESETS.some((p) => p.id === accent))) {
    for (const t of ACCENT_TOKENS) root.style.removeProperty(t);
    return;
  }
  const tokens = deriveAccent(accentHex(accent), theme);
  for (const t of ACCENT_TOKENS) root.style.setProperty(t, tokens[t]);
}
