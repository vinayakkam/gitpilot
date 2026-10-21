import { layoutGraph } from "./graph";

describe("commit graph", () => {
  it("keeps a straight line for linear history", () => {
    const rows = layoutGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.width === 1)).toBe(true);
    expect(rows[2]!.bottom).toEqual([]);
  });

  it("draws a branch and its merge", () => {
    // m merges f (feature) into b; history: a ← b ← m, a ← f ← m
    const rows = layoutGraph([
      { hash: "m", parents: ["b", "f"] },
      { hash: "f", parents: ["a"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows[0]!.col).toBe(0);
    // The merge opens a second lane for its second parent.
    expect(rows[0]!.bottom.map(([from, to]) => [from, to])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(rows[1]!.col).toBe(1);
    expect(rows[2]!.col).toBe(0);
    // The feature line joins the main line on its way to the common ancestor, which stays left.
    expect(rows[2]!.bottom.some(([from, to]) => from === 1 && to === 0)).toBe(true);
    expect(rows[3]!.col).toBe(0);
    expect(rows[3]!.width).toBe(1);
    // Different colours for the two lines of work.
    expect(rows[1]!.color).not.toBe(rows[2]!.color);
  });

  it("starts a new lane for an unrelated tip and reuses freed lanes", () => {
    const rows = layoutGraph([
      { hash: "x", parents: ["w"] },
      { hash: "y", parents: ["w"] },
      { hash: "w", parents: [] },
      { hash: "z", parents: [] },
    ]);
    expect(rows[1]!.col).toBe(1);
    expect(rows[2]!.col).toBe(0);
    expect(rows[3]!.col).toBe(0);
  });
});
