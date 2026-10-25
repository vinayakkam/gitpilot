import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LfsMissingNotice } from "@/features/changes/LfsMissingNotice";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { LfsCard, lfsPatternProblem } from "./LfsCard";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  lfsStatus: vi.fn(),
  lfsTrack: vi.fn(),
  lfsUntrack: vi.fn(),
  lfsInstallHooks: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const pattern = (p: string, file = ".gitattributes") => ({ pattern: p, file });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const inStore = (ui: React.ReactNode) => render(<AppStoreProvider>{ui}</AppStoreProvider>);

describe("LfsCard", () => {
  it("checks patterns like the backend", () => {
    expect(lfsPatternProblem("*.psd")).toBeNull();
    expect(lfsPatternProblem(" ")).toMatch(/Enter/);
    expect(lfsPatternProblem("--help")).toMatch(/can't start/);
    expect(lfsPatternProblem("a\nb")).toMatch(/one line/);
  });

  it("warns when the repository needs LFS but it isn't installed", async () => {
    api.lfsStatus.mockResolvedValue({ installed: false, version: null, patterns: [pattern("*.psd")], files: [], fileCount: 0, hooksInstalled: false });
    inStore(<LfsCard />);
    expect(await screen.findByText(/isn't installed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get Git LFS/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Store a file type/ })).not.toBeInTheDocument();
  });

  it("lists file types, tracks a new one and sets up hooks", async () => {
    api.lfsStatus.mockResolvedValue({
      installed: true,
      version: "git-lfs/3.5.1",
      patterns: [pattern("*.psd"), pattern("*.mov", "art/.gitattributes")],
      files: [{ path: "a.psd", downloaded: true }, { path: "b.psd", downloaded: false }],
      fileCount: 2,
      hooksInstalled: false,
    });
    api.lfsTrack.mockResolvedValue(undefined);
    api.lfsInstallHooks.mockResolvedValue(undefined);
    inStore(<LfsCard />);
    expect(await screen.findByText(/2 files/)).toBeInTheDocument();
    expect(screen.getByText(/1 not downloaded/)).toBeInTheDocument();
    // Only patterns from the root .gitattributes can be removed here.
    expect(screen.getByRole("button", { name: "Stop storing *.psd with LFS…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop storing *.mov with LFS…" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Store a file type with LFS…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Files to store with LFS"), { target: { value: " *.mp4 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Store with LFS" }));
    await waitFor(() => expect(api.lfsTrack).toHaveBeenCalledWith(1, "*.mp4"));

    fireEvent.click(screen.getByRole("button", { name: "Set up LFS for this repository" }));
    await waitFor(() => expect(api.lfsInstallHooks).toHaveBeenCalledWith(1));
  });
});

describe("LfsMissingNotice", () => {
  it("shows only when LFS is used but missing", async () => {
    api.lfsStatus.mockResolvedValue({ installed: false, version: null, patterns: [pattern("*.psd")], files: [], fileCount: 0, hooksInstalled: false });
    const { unmount } = render(<LfsMissingNotice repoId={1} />);
    expect(await screen.findByText(/stored with Git LFS, which isn't installed/)).toBeInTheDocument();
    expect(api.lfsStatus).toHaveBeenCalledWith(1, false);
    unmount();
    api.lfsStatus.mockResolvedValue({ installed: false, version: null, patterns: [], files: [], fileCount: 0, hooksInstalled: false });
    render(<LfsMissingNotice repoId={1} />);
    await waitFor(() => expect(api.lfsStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
