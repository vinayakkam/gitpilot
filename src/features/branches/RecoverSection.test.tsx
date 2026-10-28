import { fireEvent, render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { describeReflog, RecoverSection, recoverRows } from "./RecoverSection";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  reflogList: vi.fn(),
  backupList: vi.fn(),
  backupRestore: vi.fn(),
  backupDelete: vi.fn(),
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
  api.backupList.mockResolvedValue([backup]);
  api.backupRestore.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const backup = { name: "refs/gitpilot/backups/1699999999500", hash: "bak1234", subject: "Saved state", time: 1_699_999_999, label: "deleted branch topic", wip: null };

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

describe("recoverRows", () => {
  it("merges reflog and backups newest first; backups survive the lost filter", () => {
    const reflog = [entry(0, "a", "commit", "", "A", false), entry(3, "b", "commit", "", "B", true)];
    const b = { ...backup, time: 1_699_999_998 };
    expect(recoverRows(reflog, [b], false).map((r) => r.kind)).toEqual(["reflog", "backup", "reflog"]);
    expect(recoverRows(reflog, [b], true).map((r) => (r.kind === "reflog" ? r.e.hash : r.b.hash))).toEqual(["bak1234", "b"]);
  });
});

describe("RecoverSection", () => {
  it("restores a backup after confirming", async () => {
    setup();
    const section = await screen.findByRole("region", { name: "Recover" });
    expect(await within(section).findByText("Backup (deleted branch topic)")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await vi.waitFor(() => expect(api.backupRestore).toHaveBeenCalledWith(1, backup.name));
  });

  it("has no accessibility violations", async () => {
    setup();
    await screen.findByRole("region", { name: "Recover" });
    await expectNoAxeViolations();
  });

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
