import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { afterApplying, ConflictHelpDialog } from "./ConflictHelpDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  aiConflictHelp: vi.fn(),
  conflictApplyText: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const sug = (index: number, block: string, resolution: string) => ({ index, block, explanation: `Why ${index}`, resolution });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.2", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("afterApplying", () => {
  it("drops the used suggestion and renumbers later conflicts", () => {
    const out = afterApplying([sug(0, "a", "A"), sug(1, "b", "B"), sug(2, "c", "C")], 1);
    expect(out.map((s) => [s.index, s.block])).toEqual([
      [0, "a"],
      [1, "c"],
    ]);
  });
});

describe("ConflictHelpDialog", () => {
  it("applies an edited suggestion to the right conflict, then renumbers the rest", async () => {
    api.aiConflictHelp.mockResolvedValue({ summary: "Both sides renamed it.", suggestions: [sug(0, "<<a>>", "A\n"), sug(1, "<<b>>", "B\n")], model: "acme/large" });
    api.conflictApplyText.mockResolvedValue(1);
    const onClose = vi.fn();
    render(
      <AppStoreProvider>
        <ConflictHelpDialog path="src/x.ts" onClose={onClose} />
      </AppStoreProvider>,
    );
    expect(await screen.findByText("Both sides renamed it.")).toBeInTheDocument();
    await waitFor(() => expect(api.aiConflictHelp).toHaveBeenCalledWith(1, "src/x.ts"));
    fireEvent.change(screen.getByLabelText("Suggested text for conflict 1"), { target: { value: "A edited\n" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0]!);
    await waitFor(() => expect(api.conflictApplyText).toHaveBeenCalledWith(1, "src/x.ts", 0, "<<a>>", "A edited\n"));
    // The second conflict is now the first one in the file.
    expect(await screen.findByLabelText("Suggested text for conflict 1")).toHaveValue("B\n");
    expect(screen.queryByLabelText("Suggested text for conflict 2")).not.toBeInTheDocument();

    api.conflictApplyText.mockResolvedValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(api.conflictApplyText).toHaveBeenLastCalledWith(1, "src/x.ts", 0, "<<b>>", "B\n"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
