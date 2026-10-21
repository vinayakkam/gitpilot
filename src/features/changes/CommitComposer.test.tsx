import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { CommitComposer } from "./CommitComposer";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  identityGet: vi.fn(),
  commit: vi.fn(),
  aiSuggestCommit: vi.fn(),
  eolCheck: vi.fn(),
  lastCommit: vi.fn(),
  commitAmend: vi.fn(),
  commitUndo: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const staged = [{ path: "a.ts", origPath: null, area: "staged" as const, change: "modified" as const, conflict: null, submodule: false, ignored: false }];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.1.0", os: "linux", gitPath: "/usr/bin/git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status(staged));
  api.identityGet.mockResolvedValue({ name: "Ann", email: "ann@x.dev" });
  api.eolCheck.mockResolvedValue({ issues: [], hasTextRule: false, autocrlf: null });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function setup(stagedCount: number) {
  return render(
    <AppStoreProvider>
      <CommitComposer stagedCount={stagedCount} />
    </AppStoreProvider>,
  );
}

describe("CommitComposer", () => {
  it("explains when nothing is staged and never commits", async () => {
    setup(0);
    const btn = await screen.findByRole("button", { name: "No staged changes" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Commit summary"), { target: { value: "Something" } });
    expect(btn).toBeDisabled();
    expect(api.commit).not.toHaveBeenCalled();
  });

  it("requires a summary, then commits summary + description with Ctrl+Enter", async () => {
    api.commit.mockResolvedValue("1234567890abcdef");
    setup(1);
    const btn = await screen.findByRole("button", { name: /Commit 1 file to main/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Commit summary"), { target: { value: "Fix login redirect" } });
    fireEvent.change(screen.getByLabelText("Commit description (optional)"), { target: { value: "Keeps the return URL." } });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.keyDown(screen.getByLabelText("Commit summary"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.commit).toHaveBeenCalledWith(1, "Fix login redirect\n\nKeeps the return URL."));
    await waitFor(() => expect(screen.getByLabelText("Commit summary")).toHaveValue(""));
  });

  it("shows the backend's explanation when a commit fails", async () => {
    api.commit.mockRejectedValue({ kind: "hookFailed", message: "A commit hook rejected this commit.", detail: "lint failed" });
    setup(1);
    await waitFor(() => expect(api.identityGet).toHaveBeenCalledWith(1)); // repository is open
    fireEvent.change(await screen.findByLabelText("Commit summary"), { target: { value: "Try" } });
    fireEvent.click(await screen.findByRole("button", { name: /Commit 1 file/ }));
    expect(await screen.findByText("A commit hook rejected this commit.")).toBeInTheDocument();
    expect(screen.getByLabelText("Commit summary")).toHaveValue("Try");
  });

  it("warns about a missing Git identity", async () => {
    api.identityGet.mockResolvedValue({ name: null, email: null });
    setup(1);
    expect(await screen.findByText(/needs your name and email/)).toBeInTheDocument();
  });

  it("doesn't call the AI when it's disabled", async () => {
    setup(1);
    fireEvent.click(await screen.findByRole("button", { name: "Suggest a commit message with AI" }));
    expect(api.aiSuggestCommit).not.toHaveBeenCalled();
  });

  it("amends the last commit with its message pre-filled, then restores the draft", async () => {
    api.lastCommit.mockResolvedValue({ hash: "abc1234", message: "Fix login\n\nOld body", pushed: false, isMerge: false, isRoot: false });
    api.commitAmend.mockResolvedValue("def5678000");
    setup(0);
    await waitFor(() => expect(api.identityGet).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText("Commit summary"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByLabelText("Amend last commit"));
    await waitFor(() => expect(screen.getByLabelText("Commit summary")).toHaveValue("Fix login"));
    expect(screen.getByLabelText("Commit description (optional)")).toHaveValue("Old body");
    const btn = screen.getByRole("button", { name: "Amend last commit" });
    expect(btn).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Commit summary"), { target: { value: "Fix login redirect" } });
    fireEvent.click(btn);
    await waitFor(() => expect(api.commitAmend).toHaveBeenCalledWith(1, "Fix login redirect\n\nOld body", false));
    await waitFor(() => expect(screen.getByLabelText("Commit summary")).toHaveValue("My draft"));
  });

  it("asks before amending a commit that was already pushed", async () => {
    api.lastCommit.mockResolvedValue({ hash: "abc1234", message: "Pushed", pushed: true, isMerge: false, isRoot: false });
    api.commitAmend.mockResolvedValue("def5678000");
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
    setup(0);
    await waitFor(() => expect(api.identityGet).toHaveBeenCalled());
    fireEvent.click(await screen.findByLabelText("Amend last commit"));
    expect(await screen.findByText("Already pushed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Amend last commit" }));
    expect(api.commitAmend).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Amend anyway" }));
    await waitFor(() => expect(api.commitAmend).toHaveBeenCalledWith(1, "Pushed", true));
  });
});
