import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoAxeViolations } from "@/test/axe";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings } from "@/test/fixtures";
import { SettingsView } from "./SettingsView";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSave: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  secretStatus: vi.fn(),
  openRouterKeyInfo: vi.fn(),
  openRouterModels: vi.fn(),
  claudeDetect: vi.fn(),
  openCodeDetect: vi.fn(),
  claudeAuthStatus: vi.fn(),
  claudeLogin: vi.fn(),
  updateSupport: vi.fn(),
  editorList: vi.fn(),
  signingGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/updates/UpdateSettings", () => ({ UpdateSettings: () => <p>update settings</p> }));
vi.mock("@/features/github/GitHubAccountCard", () => ({ GitHubAccountCard: () => <p>account</p> }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.settingsSave.mockImplementation((s) => Promise.resolve(s));
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.3.0", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockRejectedValue({ kind: "x", message: "no" });
  api.secretStatus.mockResolvedValue({ stored: true, envVar: null, keychainAvailable: true, keychainError: null });
  api.openRouterKeyInfo.mockResolvedValue({ label: "sk-or-v1-abc", usage: 0.42, limit: null, limitRemaining: null, isFreeTier: false });
  api.openRouterModels.mockResolvedValue([
    { id: "openrouter/auto", name: "Auto Router", contextLength: 2000000, promptPerMillion: null, completionPerMillion: null, free: false },
    { id: "acme/large", name: "Acme Large", contextLength: 200000, promptPerMillion: 3, completionPerMillion: 15, free: false },
    { id: "acme/small:free", name: "Acme Small (free)", contextLength: 8192, promptPerMillion: 0, completionPerMillion: 0, free: true },
  ]);
  api.claudeDetect.mockResolvedValue({ found: true, path: "/usr/bin/claude", version: "2.1.0", source: "path", terminal: "/usr/bin/xterm" });
  api.openCodeDetect.mockResolvedValue({ found: true, path: "/home/me/.opencode/bin/opencode", version: "1.2.3", source: "known location", terminal: "/usr/bin/xterm" });
  api.claudeAuthStatus.mockResolvedValue({ checked: true, loggedIn: false, method: null, detail: null });
  api.editorList.mockResolvedValue([{ id: "zed", name: "Zed", path: "/usr/bin/zed" }]);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const lastSaved = () => api.settingsSave.mock.calls.at(-1)?.[0];

function setup() {
  return render(
    <AppStoreProvider>
      <SettingsView />
    </AppStoreProvider>,
  );
}

describe("SettingsView", () => {
  it("has no accessibility violations", async () => {
    setup();
    for (const pane of ["General", "Git", "GitHub"]) {
      fireEvent.click(await screen.findByRole("button", { name: pane }));
      await screen.findByRole("heading", { name: pane });
      await expectNoAxeViolations();
    }
  });

  it("picks a code editor and a merge tool", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    const editor = await screen.findByLabelText("Code editor");
    expect(await screen.findByRole("option", { name: "Automatic (Zed)" })).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "custom" } });
    await waitFor(() => expect(lastSaved()?.tools.editor).toBe("custom"));
    const tool = screen.getByLabelText("Merge tool");
    fireEvent.change(tool, { target: { value: " meld " } });
    fireEvent.blur(tool);
    await waitFor(() => expect(lastSaved()?.tools.mergeTool).toBe("meld"));
  });

  it("turns off the GitHub sign-in for git over HTTPS", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("switch", { name: /Use this sign-in for clone/ }));
    await waitFor(() => expect(lastSaved()?.github).toEqual({ clientId: "", useForHttps: false }));
  });

  it("search narrows the sections", async () => {
    setup();
    const search = await screen.findByLabelText("Search settings");
    fireEvent.change(search, { target: { value: "crlf" } });
    expect(screen.getByRole("button", { name: "Git" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appearance" })).not.toBeInTheDocument();
    expect(screen.getByText("Check line endings before committing")).toBeInTheDocument();
  });

  it("changes the accent colour with a preset or a custom hex", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("radio", { name: "Green" }));
    await waitFor(() => expect(lastSaved()?.accent).toBe("green"));
    const hex = screen.getByLabelText("Accent colour hex value");
    fireEvent.change(hex, { target: { value: "#ff8800" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    await waitFor(() => expect(lastSaved()?.accent).toBe("#ff8800"));
  });

  it("OpenRouter is the default and models can be searched and picked", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "AI" }));
    expect(screen.getByRole("radio", { name: /OpenRouter/ })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText(/Key verified/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Free only"));
    expect(await screen.findByText("Acme Small (free)")).toBeInTheDocument();
    expect(screen.queryByText("Acme Large")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Acme Small/ }));
    await waitFor(() => expect(lastSaved()?.ai.model).toBe("acme/small:free"));
  });

  it("switching to Claude Code uses the Claude account and offers sign-in", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "AI" }));
    fireEvent.click(screen.getByRole("radio", { name: /Claude Code/ }));
    await waitFor(() => expect(lastSaved()?.ai).toMatchObject({ provider: "claudeCode", model: "haiku" }));
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Claude" }));
    await waitFor(() => expect(api.claudeLogin).toHaveBeenCalled());
  });

  it("chooses OpenCode as the coding assistant", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Coding assistant" }));
    expect(await screen.findByText(/Found OpenCode 1\.2\.3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Open the Assistant's prompts in"), { target: { value: "openCode" } });
    await waitFor(() => expect(lastSaved().assistantTool).toBe("openCode"));
  });
});
