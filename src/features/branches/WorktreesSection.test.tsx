import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { joinPath, worktreeFolderName, WorktreesSection } from "./WorktreesSection";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  worktreeList: vi.fn(),
  worktreeAdd: vi.fn(),
  worktreeRemove: vi.fn(),
  worktreePrune: vi.fn(),
  branches: vi.fn(),
  repoAdd: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

const wt = (path: string, branch: string | null, extra = {}) => ({ path, head: "abc1234", branch, detached: branch === null, bare: false, main: false, current: false, locked: false, prunable: false, ...extra });
const br = (name: string) => ({ name, fullRef: `refs/heads/${name}`, isRemote: false, remote: null, isCurrent: false, upstream: null, ahead: null, behind: null, upstreamGone: false, tip: "a", lastCommitTime: 0, subject: "x", merged: null });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.worktreeList.mockResolvedValue([wt("/work/acme", "main", { main: true, current: true }), wt("/work/acme-fix", "fix"), wt("/work/gone", "old", { prunable: true })]);
  api.branches.mockResolvedValue([br("main"), br("fix"), br("docs")]);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const setup = () =>
  render(
    <AppStoreProvider>
      <WorktreesSection />
    </AppStoreProvider>,
  );

describe("worktree helpers", () => {
  it("names and joins folders", () => {
    expect(worktreeFolderName("acme", "feature/login")).toBe("acme-feature-login");
    expect(joinPath("/work/", "acme-fix")).toBe("/work/acme-fix");
    expect(joinPath("C:\\Users\\me\\code", "acme-fix")).toBe("C:\\Users\\me\\code\\acme-fix");
  });
});

describe("WorktreesSection", () => {
  it("lists worktrees, removes one, and cleans up missing folders", async () => {
    api.worktreeRemove.mockResolvedValue(undefined);
    api.worktreePrune.mockResolvedValue(undefined);
    setup();
    expect(await screen.findByText("/work/acme-fix")).toBeInTheDocument();
    expect(screen.getByText("open here")).toBeInTheDocument();
    expect(screen.getByText("folder missing")).toBeInTheDocument();
    // The main and the open worktree can't be removed.
    expect(screen.queryByRole("button", { name: "Remove worktree main…" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove worktree fix…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove worktree" }));
    await waitFor(() => expect(api.worktreeRemove).toHaveBeenCalledWith(1, "/work/acme-fix"));
    fireEvent.click(screen.getByRole("button", { name: "Clean up" }));
    await waitFor(() => expect(api.worktreePrune).toHaveBeenCalledWith(1));
  });

  it("creates a worktree for a branch that isn't checked out anywhere", async () => {
    dialog.open.mockResolvedValue("/work");
    api.worktreeAdd.mockResolvedValue("/work/acme-docs");
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "New worktree" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New worktree" }));
    const d = await screen.findByRole("dialog");
    // main and fix are taken; docs is offered.
    await waitFor(() => expect(within(d).getByLabelText("Branch to check out")).toHaveValue("docs"));
    expect(within(d).queryByRole("option", { name: "fix" })).not.toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Choose…" }));
    expect(await within(d).findByText("/work/acme-docs")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Create worktree" }));
    await waitFor(() => expect(api.worktreeAdd).toHaveBeenCalledWith(1, "/work/acme-docs", "docs", false, null));
  });
});
