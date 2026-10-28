import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { PullReviewDialog } from "./PullReviewDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  githubPullDetail: vi.fn(),
  githubPullFiles: vi.fn(),
  githubPullConversation: vi.fn(),
  githubPullChecks: vi.fn(),
  githubPullComment: vi.fn(),
  githubPullReview: vi.fn(),
  githubPullMerge: vi.fn(),
  githubPullDeleteBranch: vi.fn(),
  aiExplain: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
// The real viewer needs layout (ResizeObserver); show the changed lines as text instead.
vi.mock("@/features/diff/DiffViewer", () => ({
  DiffViewer: ({ diff }: { diff: { hunks: { lines: { content: string }[] }[] } | null }) => <pre>{diff?.hunks.flatMap((h) => h.lines.map((l) => l.content)).join("\n")}</pre>,
}));

const target = { owner: "me", name: "app", fullName: "me/app", htmlUrl: "https://github.com/me/app", defaultBranch: "main", remote: "origin" };
const detail = { number: 7, title: "Add login", body: "Adds **login**.", url: "https://github.com/me/app/pull/7", author: "ann", state: "open", draft: false, headRef: "login", headSha: "abc1234", baseRef: "main", crossRepository: false, mergeable: true, mergeableState: "clean", additions: 2, deletions: 1, changedFiles: 1 };
const fileDiff = { oldPath: "a.ts", newPath: "a.ts", binary: false, newFile: false, deletedFile: false, renamed: false, similarity: null, oldMode: null, newMode: null, additions: 1, deletions: 1, truncated: false, conflictView: false, hunkActions: false, image: null, hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: "del", content: "old line", oldNo: 1, newNo: null, crlf: false }, { kind: "add", content: "new line", oldNo: null, newNo: 1, crlf: false }] }] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.githubPullDetail.mockResolvedValue(detail);
  api.githubPullFiles.mockResolvedValue([{ path: "a.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, diff: fileDiff }]);
  api.githubPullConversation.mockResolvedValue([{ kind: "review", author: "bob", body: "Looks good", createdAt: "2026-10-20T00:00:00Z", reviewState: "APPROVED", path: null, line: null, url: "u" }]);
  api.githubPullChecks.mockResolvedValue([{ name: "build", result: "failure", url: "https://github.com/x" }]);
  api.githubPullReview.mockResolvedValue(undefined);
  api.githubPullMerge.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const setup = () =>
  render(
    <AppStoreProvider>
      <PullReviewDialog target={target} number={7} onClose={() => {}} onChanged={() => {}} />
      <Toaster />
    </AppStoreProvider>,
  );

describe("PullReviewDialog", () => {
  it("has no accessibility violations", async () => {
    setup();
    await screen.findByRole("option", { name: /a.ts/ });
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole("radio", { name: "Conversation" }));
    await screen.findByText("Looks good");
    await expectNoAxeViolations();
  });

  it("shows files, the conversation and checks", async () => {
    setup();
    expect(await screen.findByText("Add login #7")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /a.ts/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText(/new line/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Conversation" }));
    expect(await screen.findByText("Looks good")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Checks" }));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(api.githubPullChecks).toHaveBeenCalledWith("me", "app", "abc1234");
  });

  it("requests changes and needs a comment for it", async () => {
    setup();
    const reqBtn = await screen.findByRole("button", { name: "Request changes" });
    expect(reqBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "Rename this" } });
    fireEvent.click(reqBtn);
    await waitFor(() => expect(api.githubPullReview).toHaveBeenCalledWith("me", "app", 7, "requestChanges", "Rename this"));
  });

  it("merges only after confirming, at the reviewed commit", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("Merge method"), { target: { value: "squash" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const confirm = await screen.findByRole("dialog", { name: /Merge #7 into main/ });
    expect(api.githubPullMerge).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(api.githubPullMerge).toHaveBeenCalledWith("me", "app", 7, "squash", "abc1234"));
  });

  it("asks the AI to explain the whole pull request", async () => {
    api.aiExplain.mockResolvedValue({ text: "It adds a login form.", model: "m", excludedFiles: [], truncated: false });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
    expect(await screen.findByText("It adds a login form.")).toBeInTheDocument();
    expect(api.aiExplain).toHaveBeenCalledWith(1, { kind: "pullRequest", owner: "me", name: "app", number: 7 });
  });

  it("won't merge a pull request with conflicts", async () => {
    api.githubPullDetail.mockResolvedValue({ ...detail, mergeable: false, mergeableState: "dirty" });
    setup();
    expect(await screen.findByText(/has conflicts with its base branch/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });
});
