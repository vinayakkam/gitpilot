import { contentMatcher } from "./HistoryView";

vi.mock("@/lib/api", () => ({ api: {}, onProgress: () => Promise.resolve(() => {}) }));

describe("contentMatcher", () => {
  it("matches literal text case-sensitively, like git log -S", () => {
    const m = contentMatcher("answer", false)!;
    expect(m("let answer = 42;")).toBe(true);
    expect(m("let Answer = 42;")).toBe(false);
    expect(contentMatcher("a.b", false)!("axb")).toBe(false);
  });

  it("matches a regular expression, like git log -G", () => {
    const m = contentMatcher("answer = [0-9]+", true)!;
    expect(m("let answer = 42;")).toBe(true);
    expect(m("let answer = x;")).toBe(false);
  });

  it("marks nothing without a search or with an invalid pattern", () => {
    expect(contentMatcher("", false)).toBeUndefined();
    expect(contentMatcher("a(", true)).toBeUndefined();
  });
});
