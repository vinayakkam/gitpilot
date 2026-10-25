import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { AssistantView } from "./AssistantView";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  log: vi.fn(),
  claudeDetect: vi.fn(),
  openCodeDetect: vi.fn(),
  assistantLaunch: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue({ ...settings, assistantTool: "openCode" });
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.log.mockResolvedValue({ commits: [], hasMore: false });
  api.claudeDetect.mockResolvedValue({ found: false, path: null, version: null, source: null, terminal: null });
  api.openCodeDetect.mockResolvedValue({ found: true, path: "/home/me/.opencode/bin/opencode", version: "1.2.3", source: "known location", terminal: "/usr/bin/xterm" });
  api.assistantLaunch.mockResolvedValue(undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("AssistantView", () => {
  it("opens the assistant chosen in Settings (OpenCode) with the prompt", async () => {
    render(
      <AppStoreProvider>
        <AssistantView />
      </AppStoreProvider>,
    );
    const open = await screen.findByRole("button", { name: "Open in OpenCode with this prompt" });
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    await waitFor(() => expect(open).toBeEnabled());
    expect(api.claudeDetect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Prompt")).not.toHaveValue(""));
    fireEvent.click(open);
    await waitFor(() => expect(api.assistantLaunch).toHaveBeenCalledWith(1, (screen.getByLabelText("Prompt") as HTMLTextAreaElement).value));
    fireEvent.click(screen.getByRole("button", { name: "Open without prompt" }));
    await waitFor(() => expect(api.assistantLaunch).toHaveBeenLastCalledWith(1, null));
  });
});
