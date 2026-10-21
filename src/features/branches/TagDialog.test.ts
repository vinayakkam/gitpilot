import { tagNameProblem } from "./TagDialog";

describe("tag names", () => {
  it("accepts version tags and rejects invalid ones", () => {
    expect(tagNameProblem("v1.2.0")).toBeNull();
    expect(tagNameProblem("release/2026-10")).toBeNull();
    expect(tagNameProblem("")).toBeNull();
    expect(tagNameProblem("v 1")).toMatch(/spaces/);
    for (const bad of ["v1..2", "-x", "x.lock", "a:b", "x/", "a~1", "a^", "@{x"]) expect(tagNameProblem(bad), bad).not.toBeNull();
  });
});
