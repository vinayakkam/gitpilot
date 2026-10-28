import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { filterIssues, IssuesList } from "./IssuesList";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  githubIssues: vi.fn(),
  githubIssueCreate: vi.fn(),
  branchCreate: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

const target = { owner: "me", name: "app", fullName: "me/app", htmlUrl: "https://github.com/me/app", defaultBranch: "main", remote: "origin" };
const issue = (number: number, title: string, labels: string[] = []) => ({ number, title, url: `https://github.com/me/app/issues/${number}`, author: "ann", labels, assignees: [], comments: 0, updatedAt: "2026-10-20T00:00:00Z" });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.githubIssues.mockResolvedValue([issue(12, "Crash on start", ["bug"]), issue(13, "Dark mode")]);
  api.branchCreate.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const setup = () => render(<AppStoreProvider><IssuesList target={target} /><Toaster /></AppStoreProvider>);

describe("filterIssues", () => {
  it("matches title, #number and labels", () => {
    const all = [issue(12, "Crash on start", ["bug"]), issue(13, "Dark mode")];
    expect(filterIssues(all, "#13").map((i) => i.number)).toEqual([13]);
    expect(filterIssues(all, "BUG").map((i) => i.number)).toEqual([12]);
    expect(filterIssues(all, "")).toHaveLength(2);
  });
});

describe("IssuesList", () => {
  it("has no accessibility violations", async () => {
    setup();
    await screen.findByText("Crash on start");
    await expectNoAxeViolations();
  });

  it("starts work on an issue from the remote's default branch", async () => {
    setup();
    const row = (await screen.findByText("Crash on start")).closest("div.flex.items-start") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(api.branchCreate).toHaveBeenCalledWith(1, "12-crash-on-start", "origin/main", true));
  });

  it("opens a new issue", async () => {
    api.githubIssueCreate.mockResolvedValue(issue(14, "Typo"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "New issue" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Typo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open issue" }));
    await waitFor(() => expect(api.githubIssueCreate).toHaveBeenCalledWith("me", "app", "Typo", ""));
    expect(await screen.findByText("Opened issue #14")).toBeInTheDocument();
  });
});
