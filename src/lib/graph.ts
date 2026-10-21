// Commit graph layout for History. Commits must arrive children-before-parents (git log
// --date-order). Each row gets the lanes entering from above, the lanes leaving below, and
// the commit's own lane; the view draws lines between them.

export interface GraphRow {
  /** Lane of this commit's dot. */
  col: number;
  /** Colour index of the commit's lane. */
  color: number;
  /** Lines from the top edge to the dot or to the bottom edge: [fromCol, toCol, color, toDot]. */
  top: [number, number, number, boolean][];
  /** Lines from the dot or straight through to the bottom edge: [fromCol, toCol, color, fromDot]. */
  bottom: [number, number, number, boolean][];
  /** Number of lanes in use on this row (for sizing). */
  width: number;
}

type Lane = { hash: string; color: number } | null;

export function layoutGraph(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  let lanes: Lane[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  for (const c of commits) {
    let col = lanes.findIndex((l) => l?.hash === c.hash);
    const before = lanes.slice();
    if (col === -1) {
      // A branch tip we haven't seen a child of: start a new lane.
      col = lanes.findIndex((l) => l === null);
      if (col === -1) col = lanes.length;
      lanes[col] = { hash: c.hash, color: nextColor++ };
    }
    const color = lanes[col]!.color;

    const top: GraphRow["top"] = [];
    before.forEach((l, i) => {
      if (!l) return;
      if (l.hash === c.hash) top.push([i, col, l.color, true]);
      else top.push([i, i, l.color, false]);
    });

    // Lanes waiting for this commit end here (they merge into the dot).
    const after: Lane[] = lanes.map((l) => (l && l.hash === c.hash ? null : l));
    const parentCols: number[] = [];
    /** Lanes moved left this row: [fromCol, toCol, color]. */
    const moved: [number, number, number][] = [];
    c.parents.forEach((p, pi) => {
      const existing = after.findIndex((l) => l?.hash === p);
      if (existing !== -1 && pi === 0 && existing > col && after[col] === null) {
        // Keep the first-parent line on the left: pull the parent's lane over to this column.
        const lane = after[existing]!;
        after[col] = lane;
        after[existing] = null;
        moved.push([existing, col, lane.color]);
        parentCols.push(col);
        return;
      }
      if (existing !== -1) {
        parentCols.push(existing);
        return;
      }
      if (pi === 0 && after[col] === null) {
        after[col] = { hash: p, color };
        parentCols.push(col);
        return;
      }
      let free = after.findIndex((l) => l === null);
      if (free === -1) free = after.length;
      after[free] = { hash: p, color: pi === 0 ? color : nextColor++ };
      parentCols.push(free);
    });

    const bottom: GraphRow["bottom"] = [];
    after.forEach((l, i) => {
      if (!l) return;
      if (parentCols.includes(i)) bottom.push([col, i, l.color, true]);
      else bottom.push([i, i, l.color, false]);
    });
    for (const [from, to, clr] of moved) bottom.push([from, to, clr, false]);

    // Trim empty lanes at the end so the graph doesn't keep growing.
    while (after.length && after[after.length - 1] === null) after.pop();
    lanes = after;
    rows.push({ col, color, top, bottom, width: Math.max(before.length, after.length, col + 1) });
  }
  return rows;
}
