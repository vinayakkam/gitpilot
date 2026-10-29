import { act, render, screen } from "@testing-library/react";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { nextDelaySeconds, pullNotice, useAutoFetch } from "./useAutoFetch";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  fetch: vi.fn(),
  githubLink: vi.fn(),
  githubPulls: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const pull = vi.fn();
function Probe() {
  useAutoFetch(pull);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.values(api).forEach((f) => f.mockReset());
  pull.mockReset();
  api.settingsGet.mockResolvedValue({ ...settings, autoFetchSeconds: 15 });
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.fetch.mockResolvedValue(undefined);
  api.githubLink.mockRejectedValue({ kind: "githubNotSignedIn", message: "Sign in", detail: null });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.useRealTimers());

describe("nextDelaySeconds", () => {
  it("doubles after each failure, up to two hours", () => {
    expect(nextDelaySeconds(15, 0)).toBe(15);
    expect(nextDelaySeconds(15, 2)).toBe(60);
    expect(nextDelaySeconds(60, 30)).toBe(7200);
  });
});

describe("useAutoFetch", () => {
  it("fetches quietly on the interval and offers Pull for new commits", async () => {
    render(<AppStoreProvider><Probe /><Toaster /></AppStoreProvider>);
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    const behind = status([]);
    api.status.mockResolvedValue({ ...behind, branch: { ...behind.branch, behind: 3 } });
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(api.fetch).toHaveBeenCalledWith(1, null, true);
    expect(await screen.findByText("3 new commits on origin/main")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Pull" }).click());
    expect(pull).toHaveBeenCalled();
  });

  it("stays quiet when nothing new arrived", async () => {
    render(<AppStoreProvider><Probe /><Toaster /></AppStoreProvider>);
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Pull" })).not.toBeInTheDocument();
  });

  it("tells you when the branch's pull request fails its checks", async () => {
    const st = status([]);
    api.status.mockResolvedValue({ ...st, branch: { ...st.branch, head: "feature", upstream: "origin/feature" } });
    const ref = { owner: "me", name: "app", fullName: "me/app", htmlUrl: "https://github.com/me/app", defaultBranch: "main", remote: "origin" };
    api.githubLink.mockResolvedValue({ repo: ref, parent: null, canPush: true });
    const pr = (checks: string) => ({ number: 12, title: "Add login", url: "u", author: "me", draft: false, createdAt: "", updatedAt: "", headRef: "feature", headOwner: "me", crossRepository: false, baseRef: "main", checks, review: null });
    api.githubPulls.mockResolvedValue([pr("pending")]);
    render(<AppStoreProvider><Probe /><Toaster /></AppStoreProvider>);
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(api.githubPulls).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Checks/)).not.toBeInTheDocument();
    api.githubPulls.mockResolvedValue([pr("failing")]);
    // GitHub is asked at most once a minute, so the next three fetches don't ask.
    await act(() => vi.advanceTimersByTimeAsync(45_000));
    expect(api.githubPulls).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByText("Checks failed on #12")).toBeInTheDocument();
  });
});

describe("pullNotice", () => {
  const pr = { number: 3, checks: "passing", review: null } as Parameters<typeof pullNotice>[1];
  it("says nothing the first time or when nothing changed", () => {
    expect(pullNotice(undefined, pr)).toBeNull();
    expect(pullNotice({ checks: "passing", review: null }, pr)).toBeNull();
  });
  it("reports new check results and reviews", () => {
    expect(pullNotice({ checks: "pending", review: null }, pr)).toBe("Checks passed on #3");
    expect(pullNotice({ checks: "passing", review: null }, { ...pr, review: "approved" })).toBe("#3 was approved");
    expect(pullNotice({ checks: "passing", review: null }, { ...pr, review: "changesRequested" })).toBe("Changes were requested on #3");
    expect(pullNotice({ checks: "passing", review: null }, { ...pr, checks: "pending" })).toBeNull();
  });
});
