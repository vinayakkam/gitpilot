import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RepoStatus } from "@/bindings/RepoStatus";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { OperationBanner } from "./OperationBanner";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  sequenceRun: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

beforeAll(() => {
  // jsdom lacks <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.2.0", os: "linux", gitPath: null, gitVersion: null, gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status());
  api.sequenceRun.mockResolvedValue(undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const conflict = { path: "c.txt", origPath: null, area: "conflicted" as const, change: "conflicted" as const, conflict: "both modified", submodule: false, ignored: false };
const rebasing = (files: RepoStatus["files"]): RepoStatus => ({ ...status(files), state: "rebasing" });

function setup(s: RepoStatus) {
  return render(
    <AppStoreProvider>
      <OperationBanner status={s} />
    </AppStoreProvider>,
  );
}

describe("OperationBanner", () => {
  it("renders nothing when no operation is in progress", () => {
    const { container } = setup(status());
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks Continue while conflicts remain", async () => {
    setup(rebasing([conflict]));
    expect(screen.getByText(/stopped with 1 conflicted file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeDisabled();
  });

  it("continues once conflicts are resolved", async () => {
    setup(rebasing([]));
    await waitFor(() => expect(api.repoOpen).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Continue rebase" }));
    await waitFor(() => expect(api.sequenceRun).toHaveBeenCalledWith(1, "continue"));
  });

  it("asks before aborting", async () => {
    setup(rebasing([conflict]));
    await waitFor(() => expect(api.repoOpen).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Abort rebase" }));
    expect(api.sequenceRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/goes back to exactly where it was/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Abort rebase" }).at(-1)!);
    await waitFor(() => expect(api.sequenceRun).toHaveBeenCalledWith(1, "abort"));
  });

  it("offers abort but no skip for merges", () => {
    setup({ ...status([]), state: "merging" });
    expect(screen.getByRole("button", { name: "Abort merge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip this commit" })).not.toBeInTheDocument();
    expect(screen.getByText(/Commit to finish the merge/)).toBeInTheDocument();
  });
});
