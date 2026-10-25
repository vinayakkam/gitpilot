import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { ExplainDialog, type ExplainRequest } from "./ExplainDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));

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

function setup(request: ExplainRequest | null) {
  return render(
    <AppStoreProvider>
      <ExplainDialog request={request} onClose={() => {}} />
    </AppStoreProvider>,
  );
}

describe("ExplainDialog", () => {
  it("shows the explanation, the model and what was left out", async () => {
    const load = vi.fn().mockResolvedValue({ text: "Adds a login form.\n\n- New `LoginForm`", excludedFiles: [".env"], truncated: true, model: "acme/large" });
    setup({ title: "Commit abc1234", load });
    expect(await screen.findByText("Adds a login form.")).toBeInTheDocument();
    expect(screen.getByText("LoginForm")).toBeInTheDocument();
    expect(screen.getByText(/Written by acme\/large/)).toBeInTheDocument();
    expect(screen.getByText(/may contain secrets: \.env/)).toBeInTheDocument();
    expect(screen.getByText(/too long to send in full/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("offers to set up AI when it isn't configured", async () => {
    const load = vi.fn().mockRejectedValue({ kind: "aiNotConfigured", message: "AI features are turned off. Enable them in Settings → AI.", detail: null });
    setup({ title: "Changes", load });
    expect(await screen.findByText(/AI features are turned off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up AI" })).toBeInTheDocument();
  });
});
