import { blameRows } from "./BlameView";

describe("blame rows", () => {
  it("marks the first line of each run from the same commit", () => {
    const rows = blameRows({
      commits: [
        { hash: "a".repeat(40), author: "Ann", time: 1, summary: "First", uncommitted: false },
        { hash: "b".repeat(40), author: "Bo", time: 2, summary: "Second", uncommitted: false },
      ],
      lines: [
        { commit: 0, content: "one" },
        { commit: 0, content: "two" },
        { commit: 1, content: "three" },
        { commit: 0, content: "four" },
      ],
      truncated: false,
    });
    expect(rows.map((r) => r.first)).toEqual([true, false, true, true]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 4]);
  });
});
