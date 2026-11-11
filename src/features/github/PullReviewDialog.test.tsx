import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { lineNotes, PullReviewDialog } from "./PullReviewDialog";

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
  githubPullLineComment: vi.fn(),
  githubPullReply: vi.fn(),
  githubPullReady: vi.fn(),
  githubPullRequestReviewers: vi.fn(),
  githubPullSetLabels: vi.fn(),
  githubLabels: vi.fn(),
  githubReviewerCandidates: vi.fn(),
  githubPullRerunFailed: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
// The real viewer needs layout (ResizeObserver); show the changed lines as text instead.
vi.mock("@/features/diff/DiffViewer", () => ({
  DiffViewer: ({
    diff,
    notes,
    onLineComment,
    composer,
  }: {
    diff: { hunks: { lines: { content: string }[] }[] } | null;
    notes?: { line: number; body: string; extra?: React.ReactNode }[];
    onLineComment?: (side: "old" | "new", line: number, text: string) => void;
    composer?: { node: React.ReactNode } | null;
  }) => (
    <>
      <pre>{diff?.hunks.flatMap((h) => h.lines.map((l) => l.content)).join("\n")}</pre>
      {onLineComment && (
        <button type="button" onClick={() => onLineComment("new", 1, "new line")}>
          Comment on line 1
        </button>
      )}
      {notes?.map((n) => (
        <div key={n.body}>
          <p>{`line ${n.line}: ${n.body}`}</p>
          {n.extra}
        </div>
      ))}
      {composer?.node}
    </>
  ),
}));

const target = { owner: "me", name: "app", fullName: "me/app", htmlUrl: "https://github.com/me/app", defaultBranch: "main", remote: "origin" };
const detail = { number: 7, title: "Add login", body: "Adds **login**.", url: "https://github.com/me/app/pull/7", author: "ann", state: "open", draft: false, headRef: "login", headSha: "abc1234", baseRef: "main", crossRepository: false, mergeable: true, mergeableState: "clean", additions: 2, deletions: 1, changedFiles: 1, nodeId: "PR_7", labels: [], requestedReviewers: [] };
const fileDiff = { oldPath: "a.ts", newPath: "a.ts", binary: false, newFile: false, deletedFile: false, renamed: false, similarity: null, oldMode: null, newMode: null, additions: 1, deletions: 1, truncated: false, conflictView: false, hunkActions: false, image: null, hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ id: 1, replyTo: null, kind: "del", content: "old line", oldNo: 1, newNo: null, crlf: false }, { id: 1, replyTo: null, kind: "add", content: "new line", oldNo: null, newNo: 1, crlf: false }] }] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.githubPullDetail.mockResolvedValue(detail);
  api.githubPullFiles.mockResolvedValue([{ path: "a.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, diff: fileDiff }]);
  api.githubPullConversation.mockResolvedValue([{ id: 1, replyTo: null, kind: "review", author: "bob", body: "Looks good", createdAt: "2026-10-20T00:00:00Z", reviewState: "APPROVED", path: null, line: null, url: "u" }]);
  api.githubPullChecks.mockResolvedValue([{ name: "build", result: "failure", url: "https://github.com/x" }]);
  api.githubPullReview.mockResolvedValue(undefined);
  api.githubPullMerge.mockResolvedValue(undefined);
  api.githubLabels.mockResolvedValue([{ name: "bug", color: "d73a4a", description: "Something broke" }, { name: "docs", color: "0075ca", description: "" }]);
  api.githubReviewerCandidates.mockResolvedValue(["ann", "bob", "cy"]);
  for (const f of [api.githubPullLineComment, api.githubPullReply, api.githubPullReady, api.githubPullRequestReviewers, api.githubPullSetLabels]) f.mockResolvedValue(undefined);
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

  it("shows line comments under their lines in the Files tab", async () => {
    api.githubPullConversation.mockResolvedValue([
      { id: 1, replyTo: null, kind: "reviewComment", author: "bob", body: "Use a const", createdAt: "t", reviewState: null, path: "a.ts", line: 1, side: "RIGHT", outdated: false, url: "u" },
      { id: 1, replyTo: null, kind: "reviewComment", author: "bob", body: "Old note", createdAt: "t", reviewState: null, path: "a.ts", line: 3, side: "RIGHT", outdated: true, url: "u" },
    ]);
    setup();
    expect(await screen.findByText("line 1: Use a const")).toBeInTheDocument();
    expect(screen.queryByText(/Old note/)).not.toBeInTheDocument();
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

describe("PullReviewDialog: working with others", () => {
  it("comments on a line with a suggested change", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Comment on line 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Suggest a change" }));
    const box = screen.getByLabelText("Comment on line 1");
    expect(box).toHaveValue("```suggestion\nnew line\n```");
    fireEvent.change(box, { target: { value: "```suggestion\nnewer line\n```" } });
    fireEvent.click(within(box.parentElement!).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(api.githubPullLineComment).toHaveBeenCalledWith("me", "app", 7, "abc1234", "a.ts", 1, "RIGHT", "```suggestion\nnewer line\n```"));
    await waitFor(() => expect(screen.queryByLabelText("Comment on line 1")).not.toBeInTheDocument());
  });

  it("shows replies under their thread and replies to the first comment", async () => {
    api.githubPullConversation.mockResolvedValue([
      { id: 10, replyTo: null, kind: "reviewComment", author: "bob", body: "Use a const", createdAt: "1", reviewState: null, path: "a.ts", line: 1, side: "RIGHT", outdated: false, url: "u" },
      { id: 11, replyTo: 10, kind: "reviewComment", author: "ann", body: "Done", createdAt: "2", reviewState: null, path: "a.ts", line: 1, side: "RIGHT", outdated: false, url: "u" },
    ]);
    setup();
    expect(await screen.findByText("line 1: Use a const")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("line 1: Done")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(api.githubPullReply).toHaveBeenCalledWith("me", "app", 7, 10, "Thanks"));
  });

  it("marks a draft ready for review", async () => {
    api.githubPullDetail.mockResolvedValue({ ...detail, draft: true });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Ready for review" }));
    await waitFor(() => expect(api.githubPullReady).toHaveBeenCalledWith("PR_7"));
  });

  it("asks for reviews from people not asked yet", async () => {
    api.githubPullDetail.mockResolvedValue({ ...detail, requestedReviewers: ["bob"] });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a review" }));
    const dlg = await screen.findByRole("dialog", { name: "Ask for a review" });
    await within(dlg).findByLabelText("cy");
    expect(within(dlg).queryByLabelText("ann")).not.toBeInTheDocument();
    expect(within(dlg).queryByLabelText("bob")).not.toBeInTheDocument();
    fireEvent.click(within(dlg).getByLabelText("cy"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(api.githubPullRequestReviewers).toHaveBeenCalledWith("me", "app", 7, ["cy"]));
  });

  it("sets labels", async () => {
    api.githubPullDetail.mockResolvedValue({ ...detail, labels: ["bug"] });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit labels" }));
    const dlg = await screen.findByRole("dialog", { name: "Labels" });
    expect(await within(dlg).findByRole("checkbox", { name: /bug/ })).toBeChecked();
    fireEvent.click(within(dlg).getByRole("checkbox", { name: /bug/ }));
    fireEvent.click(within(dlg).getByRole("checkbox", { name: /docs/ }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.githubPullSetLabels).toHaveBeenCalledWith("me", "app", 7, ["docs"]));
  });

  it("re-runs failed checks and says when none can be", async () => {
    api.githubPullRerunFailed.mockResolvedValue(0);
    setup();
    fireEvent.click(await screen.findByRole("radio", { name: "Checks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Re-run failed checks" }));
    await waitFor(() => expect(api.githubPullRerunFailed).toHaveBeenCalledWith("me", "app", "abc1234"));
    expect(await screen.findByText("Nothing to run again")).toBeInTheDocument();
  });
});

describe("lineNotes", () => {
  it("keeps current line comments on the file, with the side mapped", () => {
    const c = (path: string, side: string, outdated = false) => ({ id: 1, replyTo: null, kind: "reviewComment", author: "a", body: "b", createdAt: "", reviewState: null, path, line: 4, side, outdated, url: "" });
    expect(lineNotes([c("a.ts", "LEFT"), c("b.ts", "RIGHT"), c("a.ts", "RIGHT", true)], "a.ts")).toEqual([{ side: "old", line: 4, author: "a", body: "b" }]);
    expect(lineNotes([c("a.ts", "RIGHT")], undefined)).toEqual([]);
  });
});
