import { branchNameProblem } from "./NewBranchDialog";

vi.mock("@/lib/api", () => ({ api: {} }));

describe("branchNameProblem", () => {
  it("accepts typical names", () => {
    expect(branchNameProblem("feature/login")).toBeNull();
    expect(branchNameProblem("fix-123")).toBeNull();
    expect(branchNameProblem("")).toBeNull();
  });
  it("rejects invalid names with a reason", () => {
    expect(branchNameProblem("my feature")).toMatch(/spaces/);
    expect(branchNameProblem("-x")).toMatch(/dash/);
    expect(branchNameProblem("a..b")).toMatch(/can't contain/);
    expect(branchNameProblem("topic/")).toMatch(/end with/);
    expect(branchNameProblem("x.lock")).toMatch(/end with/);
  });
});
