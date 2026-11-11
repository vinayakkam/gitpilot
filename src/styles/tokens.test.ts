import { readFileSync } from "node:fs";
import { contrast } from "@/lib/accent";

// Vitest runs from the project root.
const css = readFileSync("src/styles/tokens.css", "utf8");

/** Reads `--name: #hex;` pairs from one theme block of tokens.css. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]));
}

const [lightCss, darkCss] = css.split(':root[data-theme="dark"]') as [string, string];

const light = tokens(lightCss);
const dark = { ...light, ...tokens(darkCss) };

describe("text contrast in both themes", () => {
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    for (const bg of ["--surface", "--surface-2", "--bg"]) {
      it(`${name}: text, muted and faint text are readable on ${bg}`, () => {
        expect(contrast(t["--text"]!, t[bg]!)).toBeGreaterThanOrEqual(7);
        expect(contrast(t["--text-muted"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["--text-faint"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
