import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { CompareFilesDialog } from "./CompareFilesDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  compareFiles: vi.fn(),
  compareFileDiff: vi.fn(),
  branches: vi.fn(),
  tagList: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.branches.mockResolvedValue([]);
  api.tagList.mockResolvedValue([]);
  api.compareFiles.mockResolvedValue([
    { path: "src/a.ts", origPath: null, change: "modified", additions: 3, deletions: 1, binary: false },
    { path: "logo.png", origPath: null, change: "modified", additions: null, deletions: null, binary: true },
  ]);
  api.compareFileDiff.mockResolvedValue({ oldPath: "src/a.ts", newPath: "src/a.ts", binary: false, newFile: false, deletedFile: false, renamed: false, similarity: null, oldMode: null, newMode: null, hunks: [], additions: 3, deletions: 1, truncated: false, conflictView: false, hunkActions: false, image: null });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("CompareFilesDialog", () => {
  it("lists changed files and switches between 'since they split' and direct comparison", async () => {
    render(
      <AppStoreProvider>
        <CompareFilesDialog target={{ base: "main", head: "feature" }} onClose={() => {}} />
      </AppStoreProvider>,
    );
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
    await waitFor(() => expect(api.compareFileDiff).toHaveBeenCalledWith(1, "main", "feature", true, "src/a.ts", null));
    expect(api.compareFiles).toHaveBeenCalledWith(1, "main", "feature", true);
    fireEvent.click(screen.getByRole("radio", { name: "Directly" }));
    await waitFor(() => expect(api.compareFiles).toHaveBeenCalledWith(1, "main", "feature", false));
  });
});
