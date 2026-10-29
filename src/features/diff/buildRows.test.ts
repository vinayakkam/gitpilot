import type { FileDiff } from "@/bindings/FileDiff";
import { buildRows } from "./DiffViewer";

vi.mock("@/lib/api", () => ({ api: {}, onProgress: () => Promise.resolve(() => {}) }));

const line = (kind: "context" | "add" | "del", content: string, oldNo: number | null, newNo: number | null) => ({ kind, content, oldNo, newNo, crlf: false });
const diff = {
  oldPath: "a.ts", newPath: "a.ts", binary: false, newFile: false, deletedFile: false, renamed: false, similarity: null, oldMode: null, newMode: null,
  additions: 1, deletions: 1, truncated: false, conflictView: false, hunkActions: false, image: null,
  hunks: [{ header: "@@ -1,2 +1,2 @@", oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [line("context", "keep", 1, 1), line("del", "old two", 2, null), line("add", "new two", null, 2)] }],
} as unknown as FileDiff;

const shape = (rows: ReturnType<typeof buildRows>) => rows.map((r) => (r.t === "note" ? `note:${r.notes.map((n) => n.body).join("+")}` : r.t === "line" ? `line:${r.line.content}` : r.t));

describe("buildRows with notes", () => {
  it("puts a comment under the line it's about, on the right side", () => {
    const notes = [
      { side: "new" as const, line: 2, author: "ann", body: "rename" },
      { side: "old" as const, line: 2, author: "bob", body: "why remove" },
      { side: "new" as const, line: 1, author: "cy", body: "ok" },
    ];
    expect(shape(buildRows(diff, "unified", notes))).toEqual(["hunk", "line:keep", "note:ok", "line:old two", "note:why remove", "line:new two", "note:rename"]);
    // Side by side: the removed and added line share a row, so both comments go under it.
    expect(shape(buildRows(diff, "split", notes))).toEqual(["hunk", "pair", "note:ok", "pair", "note:why remove+rename"]);
  });

  it("drops comments on lines that aren't in the diff", () => {
    expect(shape(buildRows(diff, "unified", [{ side: "new", line: 40, author: null, body: "gone" }]))).not.toContain("note:gone");
  });
});
