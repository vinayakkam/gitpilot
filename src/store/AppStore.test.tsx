import { render, screen, waitFor } from "@testing-library/react";
import type { Settings } from "@/bindings/Settings";
import { AppStoreProvider, useStore } from "./AppStore";
import { repo, settings, status } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  onSettingsChanged: vi.fn(),
}));
const win = vi.hoisted(() => ({ label: "main" }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@/lib/windows", async (orig) => {
  const real = await orig<typeof import("@/lib/windows")>();
  return { ...real, windowLabel: () => win.label, windowRepoId: () => real.windowRepoId(win.label) };
});

const other = { ...repo, id: 2, name: "other", path: "/work/other" };
let pushSettings: ((s: Settings) => void) | null = null;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo, other]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockImplementation((id: number) => Promise.resolve(id === 2 ? other : repo));
  api.status.mockResolvedValue(status([]));
  api.onSettingsChanged.mockImplementation((cb: (s: Settings) => void) => {
    pushSettings = cb;
    return Promise.resolve(() => {});
  });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function Probe() {
  const { activeRepo, settings: s } = useStore();
  return (
    <p>
      {activeRepo?.name ?? "none"} / {s?.theme ?? "-"}
    </p>
  );
}

describe("AppStore windows", () => {
  it("the main window reopens the last repository", async () => {
    win.label = "main";
    render(
      <AppStoreProvider>
        <Probe />
      </AppStoreProvider>,
    );
    expect(await screen.findByText("acme / light")).toBeInTheDocument();
    expect(api.repoOpen).toHaveBeenCalledWith(1);
  });

  it("a repository window opens its own repository, and follows settings saved elsewhere", async () => {
    win.label = "repo-2";
    render(
      <AppStoreProvider>
        <Probe />
      </AppStoreProvider>,
    );
    expect(await screen.findByText("other / light")).toBeInTheDocument();
    expect(api.repoOpen).toHaveBeenCalledWith(2);
    expect(api.repoOpen).not.toHaveBeenCalledWith(1);
    await waitFor(() => expect(pushSettings).not.toBeNull());
    pushSettings!({ ...settings, theme: "dark" });
    expect(await screen.findByText("other / dark")).toBeInTheDocument();
  });
});
