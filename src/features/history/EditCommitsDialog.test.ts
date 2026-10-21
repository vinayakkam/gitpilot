import { summarize } from "./EditCommitsDialog";

const it_ = (hash: string, action: "pick" | "reword" | "squash" | "fixup" | "drop", newMessage = "msg") => ({ hash, action, newMessage });

describe("edit commits summary", () => {
  it("counts the resulting commits and spots problems", () => {
    const orig = ["a", "b", "c"];
    expect(summarize([it_("a", "pick"), it_("b", "pick"), it_("c", "pick")], orig)).toEqual({ result: 3, problem: null, changed: false });
    expect(summarize([it_("b", "pick"), it_("a", "pick"), it_("c", "pick")], orig).changed).toBe(true);
    expect(summarize([it_("a", "pick"), it_("b", "squash"), it_("c", "drop")], orig).result).toBe(1);
    expect(summarize([it_("a", "fixup"), it_("b", "pick"), it_("c", "pick")], orig).problem).toMatch(/first commit/);
    expect(summarize([it_("a", "drop"), it_("b", "squash"), it_("c", "pick")], orig).problem).toMatch(/first commit/);
    expect(summarize([it_("a", "drop"), it_("b", "drop"), it_("c", "drop")], orig).problem).toMatch(/at least one/);
    expect(summarize([it_("a", "reword", "  "), it_("b", "pick"), it_("c", "pick")], orig).problem).toMatch(/new message/);
  });
});
