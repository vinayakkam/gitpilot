import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings } from "@/test/fixtures";
import { UpdateDialog } from "./UpdateDialog";
import { UpdateProvider, useUpdates } from "./UpdateProvider";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  updateSupport: vi.fn(),
  updateInstallPacman: vi.fn(),
}));
const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-updater", () => updater);
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const downloadAndInstall = vi.fn();
const update = { version: "0.5.0", body: "Notes", downloadAndInstall };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  updater.check.mockReset().mockResolvedValue(update);
  downloadAndInstall.mockReset();
  api.settingsGet.mockResolvedValue({ ...settings, checkForUpdates: false });
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

function CheckButton() {
  const { checkNow, support } = useUpdates();
  return support ? <button onClick={() => void checkNow()}>Check</button> : null;
}

const ui = () =>
  render(
    <AppStoreProvider>
      <UpdateProvider>
        <CheckButton />
        <UpdateDialog />
      </UpdateProvider>
    </AppStoreProvider>,
  );

describe("UpdateDialog", () => {
  it("installs Arch updates through pacman, not the updater's installer", async () => {
    api.updateSupport.mockResolvedValue({ canInstall: true, installKind: "pacman", note: "asks for your password" });
    api.updateInstallPacman.mockImplementation(async (cb: (p: { done: number; total: number | null }) => void) => {
      cb({ done: 5, total: 10 });
      return "0.5.0";
    });
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    expect(updater.check).toHaveBeenCalledWith(expect.objectContaining({ target: "linux-x86_64-pacman" }));
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByRole("button", { name: "Restart now" })).toBeInTheDocument();
    expect(api.updateInstallPacman).toHaveBeenCalled();
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("uses the updater's installer and default target elsewhere", async () => {
    api.updateSupport.mockResolvedValue({ canInstall: true, installKind: "appimage", note: null });
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    expect(updater.check).toHaveBeenCalledWith({ timeout: 30_000 });
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalled());
    expect(api.updateInstallPacman).not.toHaveBeenCalled();
  });

  it("shows pacman's error as given", async () => {
    api.updateSupport.mockResolvedValue({ canInstall: true, installKind: "pacman", note: null });
    api.updateInstallPacman.mockRejectedValue({ kind: "invalidInput", message: "The password prompt was cancelled.", detail: null });
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByText("The password prompt was cancelled.")).toBeInTheDocument();
  });
});
