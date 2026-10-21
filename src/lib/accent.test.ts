import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentHex, applyAccent, contrast, deriveAccent } from "./accent";

describe("accent colours", () => {
  it("keeps the classic blue from the stylesheet", () => {
    const root = document.createElement("div");
    root.style.setProperty("--accent", "#ff0000");
    applyAccent(root, "blue", "light");
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });

  it("derives readable tokens for every preset in both themes", () => {
    for (const p of ACCENT_PRESETS) {
      const light = deriveAccent(p.hex, "light");
      const dark = deriveAccent(p.hex, "dark");
      // Buttons: label on accent stays readable.
      expect(contrast(light["--on-accent"], light["--accent"]), `${p.id} light button`).toBeGreaterThanOrEqual(3.6);
      expect(contrast(dark["--on-accent"], dark["--accent"]), `${p.id} dark button`).toBeGreaterThanOrEqual(3.6);
      // Accent text on the surfaces it is used on.
      expect(contrast(light["--accent-text"], "#ffffff"), `${p.id} light text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["--accent-text"], "#181b21"), `${p.id} dark text`).toBeGreaterThanOrEqual(4.5);
      for (const v of [...Object.values(light), ...Object.values(dark)]) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("handles custom and extreme colours", () => {
    expect(accentHex("#ABCDEF")).toBe("#abcdef");
    expect(accentHex("nonsense")).toBe("#3550c8");
    const yellow = deriveAccent("#ffff00", "light");
    expect(contrast(yellow["--on-accent"], yellow["--accent"])).toBeGreaterThanOrEqual(3.6);
    const grey = deriveAccent("#808080", "dark");
    expect(grey["--accent"]).toMatch(/^#[0-9a-f]{6}$/);
    const root = document.createElement("div");
    applyAccent(root, "#16a34a", "dark");
    expect(root.style.getPropertyValue("--accent")).toMatch(/^#/);
  });
});
