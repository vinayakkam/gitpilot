// A small QR encoder, enough for one pairing URL.
//
// Pairing shows a code on screen that the phone's own camera app reads, so this has to produce a
// real, scannable QR symbol -- but only ever for a short https URL. That lets it stay small:
// byte mode only, error correction level M, versions 1-10. Anything longer than about 210
// characters is refused rather than silently truncated.
//
// It's hand-written rather than a dependency because the only input it will ever see is a URL
// GitPilot built itself, and because a pairing key should pass through as little code as
// possible. `qr.test.ts` checks the output with a real QR *decoder*, so this is verified against
// something that didn't come from the same head as the encoder.

/** Error correction level M: recovers about 15% damage, the usual choice for screens. */
const EC_LEVEL_BITS = 0b00;

/** Per version (1-10): [EC codewords per block, blocks in group 1, data codewords in each,
 *  blocks in group 2, data codewords in each]. */
const EC_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

/** Centres of the alignment patterns, per version. */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const MAX_VERSION = 10;

function dataCodewords(version: number): number {
  const [, g1, d1, g2, d2] = EC_M[version]!;
  return g1 * d1 + g2 * d2;
}

/** How many bytes of payload fit, after the mode and length header. */
export function capacity(version: number): number {
  const headerBits = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataCodewords(version) * 8 - headerBits) / 8);
}

// ---------------------------------------------------------------- GF(256) --

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR field polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** The generator polynomial for `n` error-correction codewords. */
function generator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ mul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function remainder(data: number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const out = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ (out[0] ?? 0);
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i++) {
        out[i] = (out[i] ?? 0) ^ mul(gen[i + 1]!, factor);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ bits ---

class Bits {
  private bits: number[] = [];

  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  get length() {
    return this.bits.length;
  }

  /** Pads to a whole number of codewords, then with the two standard filler bytes. */
  toCodewords(total: number): number[] {
    const bits = this.bits.slice();
    const capacityBits = total * 8;
    for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    const words: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
      words.push(byte);
    }
    // The two filler bytes the spec names, alternating, until the version is full.
    for (let i = 0; words.length < total; i++) words.push(i % 2 === 0 ? 0xec : 0x11);
    return words.slice(0, total);
  }
}

// ---------------------------------------------------------------- matrix ---

type Matrix = { size: number; modules: (boolean | null)[][] };

function blank(version: number): Matrix {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null)),
  };
}

function place(m: Matrix, r: number, c: number, dark: boolean) {
  if (r >= 0 && r < m.size && c >= 0 && c < m.size) m.modules[r]![c] = dark;
}

function finder(m: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inRing = (r === 0 || r === 6) && c >= 0 && c <= 6;
      const inSide = (c === 0 || c === 6) && r >= 0 && r <= 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      place(m, row + r, col + c, inRing || inSide || inCore);
    }
  }
}

function patterns(m: Matrix, version: number) {
  finder(m, 0, 0);
  finder(m, 0, m.size - 7);
  finder(m, m.size - 7, 0);

  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    m.modules[6]![i] = dark;
    m.modules[i]![6] = dark;
  }

  const centres = ALIGNMENT[version]!;
  for (const r of centres) {
    for (const c of centres) {
      // Not over a finder pattern.
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= m.size - 9) || (r >= m.size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          place(m, r + dr, c + dc, edge !== 1);
        }
      }
    }
  }

  m.modules[m.size - 8]![8] = true; // the one module that is always dark
}

/** Reserves (with `false`) the areas format and version information will fill. */
function reserve(m: Matrix, version: number) {
  for (let i = 0; i < 9; i++) {
    if (m.modules[8]![i] === null) m.modules[8]![i] = false;
    if (m.modules[i]![8] === null) m.modules[i]![8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (m.modules[8]![m.size - 1 - i] === null) m.modules[8]![m.size - 1 - i] = false;
    if (m.modules[m.size - 1 - i]![8] === null) m.modules[m.size - 1 - i]![8] = false;
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = m.size - 11 + (i % 3);
      m.modules[r]![c] = false;
      m.modules[c]![r] = false;
    }
  }
}

function isReserved(m: Matrix, r: number, c: number): boolean {
  return m.modules[r]![c] !== null;
}

/** Walks the two-column zigzag from the bottom right, skipping the function patterns. */
function placeData(m: Matrix, codewords: number[]) {
  let bitIndex = 0;
  const bit = () => {
    const byte = codewords[bitIndex >> 3] ?? 0;
    const value = (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return value === 1;
  };

  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern column is skipped
    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!isReserved(m, row, col)) m.modules[row]![col] = bit();
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(mask: number): number {
  const data = (EC_LEVEL_BITS << 3) | mask;
  let rest = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rest & (1 << (i + 10))) rest ^= 0b10100110111 << i;
  }
  return ((data << 10) | rest) ^ 0b101010000010010;
}

function versionBits(version: number): number {
  let rest = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (rest & (1 << (i + 12))) rest ^= 0b1111100100101 << i;
  }
  return (version << 12) | rest;
}

/**
 * The 15-bit format information, written twice: once around the top-left finder, once split
 * between the other two. Bit 0 is the least significant, and the two copies run in opposite
 * directions -- getting this backwards produces a symbol that looks perfect and scans as nothing.
 */
function writeFormat(m: Matrix, mask: number) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;

    // Down the left of the top-left finder, continuing above the bottom-left one.
    if (i < 6) m.modules[i]![8] = dark;
    else if (i < 8) m.modules[i + 1]![8] = dark;
    else m.modules[m.size - 15 + i]![8] = dark;

    // Along row 8: from the right-hand finder back towards the top-left one.
    if (i < 8) m.modules[8]![m.size - 1 - i] = dark;
    else if (i === 8) m.modules[8]![7] = dark;
    else m.modules[8]![14 - i] = dark;
  }
}

function writeVersion(m: Matrix, version: number) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = m.size - 11 + (i % 3);
    m.modules[r]![c] = dark;
    m.modules[c]![r] = dark;
  }
}

/** The standard penalty score; the lowest-scoring mask is the one that gets used. */
function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;

  const run = (line: boolean[]) => {
    let total = 0;
    let count = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        count++;
      } else {
        if (count >= 5) total += 3 + (count - 5);
        count = 1;
      }
    }
    if (count >= 5) total += 3 + (count - 5);
    return total;
  };

  for (let i = 0; i < size; i++) {
    score += run(grid[i]!);
    score += run(grid.map((row) => row[i]!));
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r]![c];
      if (v === grid[r]![c + 1] && v === grid[r + 1]![c] && v === grid[r + 1]![c + 1]) score += 3;
    }
  }

  const bad = [true, false, true, true, true, false, true, false, false, false, false];
  const badReversed = bad.slice().reverse();
  const matches = (line: boolean[], at: number, pattern: boolean[]) =>
    pattern.every((want, i) => line[at + i] === want);
  for (let i = 0; i < size; i++) {
    const row = grid[i]!;
    const col = grid.map((r) => r[i]!);
    for (let j = 0; j + 11 <= size; j++) {
      if (matches(row, j, bad) || matches(row, j, badReversed)) score += 40;
      if (matches(col, j, bad) || matches(col, j, badReversed)) score += 40;
    }
  }

  const dark = grid.flat().filter(Boolean).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * Encodes `text` as a QR symbol and returns it as rows of booleans (true = dark).
 *
 * Throws if the text is too long for version 10, rather than producing a code that scans to
 * something else.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = Number(
    Object.keys(EC_M).find((v) => bytes.length <= capacity(Number(v))) ?? 0,
  );
  if (!version || version > MAX_VERSION) {
    throw new Error(`That's too long for a QR code (${bytes.length} bytes).`);
  }

  const bits = new Bits();
  bits.push(0b0100, 4); // byte mode
  bits.push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) bits.push(b, 8);

  const [ecPerBlock, g1, d1, g2, d2] = EC_M[version]!;
  const all = bits.toCodewords(dataCodewords(version));

  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let at = 0;
  for (const [count, size] of [
    [g1, d1],
    [g2, d2],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const block = all.slice(at, at + size);
      at += size;
      blocks.push(block);
      ecBlocks.push(remainder(block, ecPerBlock));
    }
  }

  // Interleave: one codeword from each block in turn, then the same for the EC codewords.
  const codewords: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) codewords.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) codewords.push(block[i]!);
  }

  const base = blank(version);
  patterns(base, version);
  reserve(base, version);
  const functional = base.modules.map((row) => row.map((v) => v !== null));
  placeData(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m: Matrix = {
      size: base.size,
      modules: base.modules.map((row) => row.slice()),
    };
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (!functional[r]![c] && MASKS[mask]!(r, c)) m.modules[r]![c] = !m.modules[r]![c];
      }
    }
    writeFormat(m, mask);
    writeVersion(m, version);
    const grid = m.modules.map((row) => row.map((v) => v === true));
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  return best!;
}

/** The QR as one SVG path, for rendering inline at any size. */
export function qrPath(grid: boolean[][]): string {
  const parts: string[] = [];
  grid.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) parts.push(`M${c} ${r}h1v1h-1z`);
    });
  });
  return parts.join("");
}
