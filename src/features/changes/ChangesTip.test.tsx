import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { ChangesTip, tipFor } from "./ChangesTip";

const api = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSave: vi.fn(), repoList: vi.fn(), appInfo: vi.fn(), repoOpen: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const file = (area: "staged" | "unstaged" | "conflicted") => ({ path: "a.txt", origPath: null, area, change: area === "conflicted" ? "conflicted" : "modified", conflict: null, submodule: false, ignored: false }) as const;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue({ ...settings, tips: true, dismissedTips: [] });
  api.settingsSave.mockImplementation((s) => Promise.resolve(s));
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("tipFor", () => {
  it("picks the tip that fits, most urgent first", () => {
    expect(tipFor(status([file("conflicted"), file("staged")]))).toEqual(["conflict", "commit"]);
    expect(tipFor(status([file("unstaged")]))).toEqual(["stage"]);
    const s = status([]);
    expect(tipFor({ ...s, branch: { ...s.branch, upstream: null } })).toEqual(["publish"]);
    expect(tipFor({ ...s, branch: { ...s.branch, detached: true } })).toEqual(["detached"]);
    expect(tipFor(s)).toEqual([]);
  });
});

describe("ChangesTip", () => {
  it("has no accessibility violations", async () => {
    render(<AppStoreProvider><ChangesTip status={status([file("unstaged")])} /></AppStoreProvider>);
    await screen.findByText("Choose what goes into your next commit");
    await expectNoAxeViolations();
  });

  it("shows a tip once and remembers when it's closed", async () => {
    render(<AppStoreProvider><ChangesTip status={status([file("unstaged")])} /></AppStoreProvider>);
    expect(await screen.findByText("Choose what goes into your next commit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it, hide this tip" }));
    await waitFor(() => expect(api.settingsSave).toHaveBeenCalledWith(expect.objectContaining({ dismissedTips: ["stage"] })));
    expect(screen.queryByText("Choose what goes into your next commit")).not.toBeInTheDocument();
  });
});
