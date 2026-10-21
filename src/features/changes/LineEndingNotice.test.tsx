import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { LineEndingNotice } from "./LineEndingNotice";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  eolCheck: vi.fn(),
  eolFix: vi.fn(),
  eolAddGitattributes: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const staged = [{ path: "src/app.ts", origPath: null, area: "staged" as const, change: "modified" as const, conflict: null, submodule: false }];
const report = {
  issues: [
    { path: "src/app.ts", kind: "lineEndingsOnly" as const, crlfLines: 40, newFile: false },
    { path: "src/new.ts", kind: "crlfIntroduced" as const, crlfLines: 3, newFile: true },
  ],
  hasTextRule: false,
  autocrlf: "false",
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.3.0", os: "windows", gitPath: "git", gitVersion: "2.47.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status(staged));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function setup(stagedCount = 2) {
  return render(
    <AppStoreProvider>
      <LineEndingNotice stagedCount={stagedCount} />
    </AppStoreProvider>,
  );
}

describe("LineEndingNotice", () => {
  it("warns about CRLF files and converts them all", async () => {
    api.eolCheck.mockResolvedValue(report);
    api.eolFix.mockResolvedValue(2);
    setup();
    expect(await screen.findByText("2 files use Windows line endings (CRLF)")).toBeInTheDocument();
    expect(screen.getByText(/context doesn't match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText(/only line endings changed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Convert to LF" }));
    await waitFor(() => expect(api.eolFix).toHaveBeenCalledWith(1, ["src/app.ts", "src/new.ts"]));
  });

  it("offers a .gitattributes rule only when none applies", async () => {
    api.eolCheck.mockResolvedValue(report);
    api.eolAddGitattributes.mockResolvedValue(true);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add \* text=auto to \.gitattributes/ }));
    await waitFor(() => expect(api.eolAddGitattributes).toHaveBeenCalledWith(1));
  });

  it("stays quiet when there is nothing to fix or nothing staged", async () => {
    api.eolCheck.mockResolvedValue({ ...report, issues: [] });
    const { container, unmount } = setup();
    await waitFor(() => expect(api.eolCheck).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    api.eolCheck.mockClear();
    setup(0);
    await screen.findByText((_, el) => el === document.body);
    expect(api.eolCheck).not.toHaveBeenCalled();
  });
});
