import { fireEvent, render, screen, within } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { describeReflog, RecoverSection } from "./RecoverSection";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  reflogList: vi.fn(),
  branchCreate: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const entry = (index: number, hash: string, action: string, message: string, subject: string, lost = false) => ({ index, hash, action, message, subject, time: 1_700_000_000 - index, lost });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.reflogList.mockResolvedValue([
    entry(0, "abc", "reset", "moving to HEAD~1", "One"),
    entry(1, "def1234", "commit", "Two", "Two", true),
    entry(2, "abc", "commit (initial)", "One", "One"),
  ]);
  api.branchCreate.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const setup = () => render(<AppStoreProvider><RecoverSection /></AppStoreProvider>);

describe("describeReflog", () => {
  it("describes git's reflog actions in plain language", () => {
    expect(describeReflog({ action: "checkout", message: "moving from main to fix" })).toBe("Switched from main to fix");
    expect(describeReflog({ action: "reset", message: "moving to HEAD~2" })).toBe("Reset to HEAD~2");
    expect(describeReflog({ action: "commit (amend)", message: "x" })).toBe("Amended the last commit");
    expect(describeReflog({ action: "merge feature", message: "Fast-forward" })).toBe("Merged feature");
    expect(describeReflog({ action: "rebase (finish)", message: "returning to refs/heads/main" })).toBe("Finished a rebase");
    expect(describeReflog({ action: "something", message: "new" })).toBe("something: new");
  });
});

describe("RecoverSection", () => {
  it("lists earlier states, marks lost commits and filters to them", async () => {
    setup();
    const section = await screen.findByRole("region", { name: "Recover" });
    expect(within(section).getByText("Reset to HEAD~1")).toBeInTheDocument();
    expect(within(section).getByText("not on a branch")).toBeInTheDocument();
    fireEvent.click(within(section).getByLabelText(/Only commits not on any branch \(1\)/));
    expect(within(section).queryByText("First commit")).not.toBeInTheDocument();
    expect(within(section).getByText("Two")).toBeInTheDocument();
  });

  it("creates a branch at a lost commit", async () => {
    setup();
    const section = await screen.findByRole("region", { name: "Recover" });
    fireEvent.click(within(section).getAllByRole("button", { name: "Create branch here…" })[1]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "rescued" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create/ }));
    await vi.waitFor(() => expect(api.branchCreate).toHaveBeenCalledWith(1, "rescued", "def1234", expect.any(Boolean)));
  });
});
