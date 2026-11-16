import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitDetail } from "@/bindings/CommitDetail";
import type { CommitSummary } from "@/bindings/CommitSummary";
import { AppStoreProvider, useStore } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { HistoryView } from "./HistoryView";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  log: vi.fn(),
  commitGet: vi.fn(),
  commitDiffFile: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const other = { ...repo, id: 2, name: "other", path: "/work/other" };

function commit(hash: string, subject: string): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    authorName: "A",
    authorEmail: "a@example.com",
    authorTime: 1_700_000_000,
    committerName: "A",
    committerEmail: "a@example.com",
    commitTime: 1_700_000_000,
    refs: [],
    subject,
  };
}

// Each repository has its own commits; asking one for the other's hash is the bug under test.
const commits: Record<number, CommitSummary[]> = {
  1: [commit("1111111111111111111111111111111111111111", "In the first repository")],
  2: [commit("2222222222222222222222222222222222222222", "In the second repository")],
};

function detail(c: CommitSummary): CommitDetail {
  return { summary: c, message: c.subject, files: [], comparedToFirstParent: false };
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo, other]);
  api.appInfo.mockResolvedValue({ version: "0.7.0", os: "windows", gitPath: "git", gitVersion: "2.51.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockImplementation((id: number) => Promise.resolve(id === 2 ? other : repo));
  api.status.mockResolvedValue(status([]));
  api.log.mockImplementation((id: number) => Promise.resolve({ commits: commits[id] ?? [], hasMore: false }));
  api.commitGet.mockImplementation((id: number, hash: string) => {
    const found = (commits[id] ?? []).find((c) => c.hash === hash);
    // What git answers for a hash from another repository.
    return found ? Promise.resolve(detail(found)) : Promise.reject({ kind: "gitFailed", message: "Git reported an error.", detail: `fatal: bad object ${hash}` });
  });
  api.commitDiffFile.mockResolvedValue(null);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Element.prototype.scrollIntoView ??= () => {};
});

function Harness() {
  const { openRepo } = useStore();
  return (
    <>
      <button onClick={() => void openRepo(2)}>Switch repository</button>
      <HistoryView />
    </>
  );
}

describe("HistoryView", () => {
  it("never asks the newly opened repository for the previous one's commit", async () => {
    const user = userEvent.setup();
    render(
      <AppStoreProvider>
        <Harness />
      </AppStoreProvider>,
    );
    expect(await screen.findByText("In the first repository")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch repository" }));

    expect(await screen.findByText("In the second repository")).toBeInTheDocument();
    await waitFor(() => expect(api.commitGet).toHaveBeenCalledWith(2, commits[2]![0]!.hash));
    expect(api.commitGet.mock.calls.filter(([id, hash]) => id === 2 && hash !== commits[2]![0]!.hash)).toEqual([]);
    expect(screen.queryByText("Git reported an error.")).not.toBeInTheDocument();
    expect(screen.queryByText("In the first repository")).not.toBeInTheDocument();
  });
});
