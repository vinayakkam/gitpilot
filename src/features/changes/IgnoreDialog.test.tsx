import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { escapeIgnore, IgnoreDialog, ignoreChoices } from "./IgnoreDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  gitignoreAdd: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));

const entry = (path: string, area: "untracked" | "unstaged") => ({ path, origPath: null, area, change: area === "untracked" ? ("untracked" as const) : ("modified" as const), conflict: null, submodule: false, ignored: false });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.3.1", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("ignore patterns", () => {
  it("escapes special characters so a path matches only itself", () => {
    expect(escapeIgnore("logs/[old]*.txt")).toBe("logs/\\[old\\]\\*.txt");
    expect(escapeIgnore("#notes")).toBe("\\#notes");
    expect(escapeIgnore("!keep")).toBe("\\!keep");
  });

  it("offers file, extension and folder choices", () => {
    const c = ignoreChoices(["build/out.log"]);
    expect(c.map((x) => x.patterns)).toEqual([["/build/out.log"], ["*.log"], ["/build/"]]);
    const two = ignoreChoices(["a/x.ts", "b/y.js"]);
    expect(two.map((x) => x.id)).toEqual(["files"]);
    expect(ignoreChoices(["README"]).map((x) => x.id)).toEqual(["files"]);
  });
});

describe("IgnoreDialog", () => {
  function setup(files: ReturnType<typeof entry>[]) {
    return render(
      <AppStoreProvider>
        <IgnoreDialog files={files} onClose={() => {}} />
      </AppStoreProvider>,
    );
  }

  it("ignores an untracked file's extension", async () => {
    api.gitignoreAdd.mockResolvedValue(["*.log"]);
    setup([entry("debug.log", "untracked")]);
    fireEvent.click(await screen.findByLabelText(/All \.log files/));
    expect(screen.getByText("*.log")).toBeInTheDocument();
    expect(screen.queryByText(/stop tracking/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await waitFor(() => expect(api.gitignoreAdd).toHaveBeenCalledWith(1, ["*.log"], []));
  });

  it("also stops tracking files that are already committed (unless unticked)", async () => {
    api.gitignoreAdd.mockResolvedValue(["/config/local.json"]);
    setup([entry("config/local.json", "unstaged")]);
    expect(await screen.findByText(/won't hide it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ignore and stop tracking" }));
    await waitFor(() => expect(api.gitignoreAdd).toHaveBeenCalledWith(1, ["/config/local.json"], ["config/local.json"]));
  });

  it("accepts a custom pattern", async () => {
    api.gitignoreAdd.mockResolvedValue(["dist/"]);
    setup([entry("dist/app.js", "untracked")]);
    fireEvent.click(await screen.findByLabelText("Custom pattern"));
    fireEvent.change(screen.getByLabelText("Custom ignore pattern"), { target: { value: "dist/" } });
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await waitFor(() => expect(api.gitignoreAdd).toHaveBeenCalledWith(1, ["dist/"], []));
  });
});
