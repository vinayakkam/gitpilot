import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { SubmodulesSection } from "./SubmodulesSection";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  submoduleList: vi.fn(),
  submoduleUpdate: vi.fn(),
  repoAdd: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const sub = (path: string, state: string, extra = {}) => ({ path, name: path, url: `https://example.com/${path}.git`, branch: null, commit: "1234567890abcdef", describe: null, state, ...extra });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.submoduleUpdate.mockResolvedValue(undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const setup = () =>
  render(
    <AppStoreProvider>
      <SubmodulesSection />
    </AppStoreProvider>,
  );

describe("SubmodulesSection", () => {
  it("is hidden when there are no submodules", async () => {
    api.submoduleList.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(api.submoduleList).toHaveBeenCalledWith(1));
    expect(screen.queryByText("Submodules")).not.toBeInTheDocument();
  });

  it("lists states and downloads, updates or opens submodules", async () => {
    api.submoduleList.mockResolvedValue([sub("deps/core", "upToDate", { describe: "v1.2.0", branch: "main" }), sub("deps/ui", "notInitialized"), sub("deps/old", "differentCommit")]);
    api.repoAdd.mockResolvedValue({ ...repo, id: 2, name: "core", path: "/work/acme/deps/core" });
    setup();
    expect(await screen.findByText("Not downloaded")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Different commit checked out")).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(api.submoduleUpdate).toHaveBeenCalledWith(1, ["deps/ui"]));
    fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
    await waitFor(() => expect(api.submoduleUpdate).toHaveBeenLastCalledWith(1, []));

    // Not downloaded yet: nothing to open.
    expect(screen.queryByRole("button", { name: "Open deps/ui in GitPilot" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open deps/core in GitPilot" }));
    await waitFor(() => expect(api.repoAdd).toHaveBeenCalledWith("/work/acme/deps/core"));
  });
});
