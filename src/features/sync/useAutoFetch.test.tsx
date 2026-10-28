import { act, render, screen } from "@testing-library/react";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { nextDelaySeconds, useAutoFetch } from "./useAutoFetch";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  fetch: vi.fn(),
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
});
