import { fireEvent, render, screen } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { RepoActionsProvider } from "@/features/onboarding/RepoActions";
import { Sidebar } from "./Sidebar";

const api = vi.hoisted(() => ({ settingsGet: vi.fn(), repoList: vi.fn(), appInfo: vi.fn(), repoOpen: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/features/updates/UpdateNotice", () => ({ UpdateNotice: () => null }));

const media = (narrow: boolean) => (q: string) => ({ matches: q.includes("max-width") ? narrow : false, addEventListener: vi.fn(), removeEventListener: vi.fn() });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.5.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  localStorage.clear();
});

describe("Sidebar", () => {
  it("collapses by itself in a narrow window and can be expanded", async () => {
    window.matchMedia = vi.fn().mockImplementation(media(true));
    render(<AppStoreProvider><RepoActionsProvider><Sidebar /></RepoActionsProvider></AppStoreProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(localStorage.getItem("gp.sidebar")).toBeNull();
  });

  it("stays open in a wide window", async () => {
    window.matchMedia = vi.fn().mockImplementation(media(false));
    render(<AppStoreProvider><RepoActionsProvider><Sidebar /></RepoActionsProvider></AppStoreProvider>);
    expect(await screen.findByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });
});
