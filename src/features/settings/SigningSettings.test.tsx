import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStoreProvider } from "@/store/AppStore";
import { SignatureBadge } from "@/features/history/SignatureBadge";
import { repo, settings, status } from "@/test/fixtures";
import { SigningSettings } from "./SigningSettings";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  signingGet: vi.fn(),
  signingKeys: vi.fn(),
  signingEnable: vi.fn(),
  signingDisable: vi.fn(),
  commitSignature: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const off = { enabled: false, scope: null, format: "gpg", key: null, allowedSigners: null };
const keys = [
  { format: "ssh", value: "/home/me/.ssh/id_ed25519", label: "id_ed25519.pub · ssh-ed25519 · me@laptop", expired: false },
  { format: "gpg", value: "ABCDEF0123456789", label: "Me <me@example.com> · ABCDEF0123456789", expired: false },
];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.5", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue(status([]));
  api.signingGet.mockResolvedValue(off);
  api.signingKeys.mockResolvedValue(keys);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const inStore = (ui: React.ReactNode) => render(<AppStoreProvider>{ui}</AppStoreProvider>);

describe("SigningSettings", () => {
  it("turns on signing globally with the chosen key", async () => {
    api.signingEnable.mockResolvedValue({ enabled: true, scope: "global", format: "gpg", key: "ABCDEF0123456789", allowedSigners: null });
    inStore(<SigningSettings />);
    expect(await screen.findByText(/Commits aren't signed/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Signing key"), { target: { value: "ABCDEF0123456789" } });
    api.signingGet.mockResolvedValue({ enabled: true, scope: "global", format: "gpg", key: "ABCDEF0123456789", allowedSigners: null });
    fireEvent.click(screen.getByRole("button", { name: "Turn on signing" }));
    await waitFor(() => expect(api.signingEnable).toHaveBeenCalledWith(null, "global", "gpg", "ABCDEF0123456789"));
    expect(await screen.findByText(/set for all repositories/)).toBeInTheDocument();
  });

  it("can apply to the open repository only, and turn off there", async () => {
    api.signingEnable.mockResolvedValue(off);
    inStore(<SigningSettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Only acme" }));
    await waitFor(() => expect(api.signingGet).toHaveBeenLastCalledWith(1));
    await screen.findByLabelText("Signing key");
    fireEvent.click(screen.getByRole("button", { name: "Turn on signing" }));
    await waitFor(() => expect(api.signingEnable).toHaveBeenCalledWith(1, "repository", "ssh", "/home/me/.ssh/id_ed25519"));

    api.signingGet.mockResolvedValue({ enabled: true, scope: "repository", format: "ssh", key: "/home/me/.ssh/id_ed25519", allowedSigners: "/d/allowed_signers" });
    fireEvent.click(screen.getByRole("radio", { name: "All repositories" }));
    fireEvent.click(screen.getByRole("radio", { name: "Only acme" }));
    api.signingDisable.mockResolvedValue(off);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(api.signingDisable).toHaveBeenCalledWith(1, "repository"));
  });
});

describe("SignatureBadge", () => {
  it("shows the status with icon and word, and nothing for unsigned commits", async () => {
    api.commitSignature.mockResolvedValue({ status: "verified", signer: "me@example.com", key: "SHA256:abc" });
    const { rerender } = inStore(<SignatureBadge repoId={1} hash="a1" />);
    expect(await screen.findByText("Verified")).toHaveAttribute("title", "me@example.com · SHA256:abc");
    api.commitSignature.mockResolvedValue({ status: "notSigned", signer: null, key: null });
    rerender(
      <AppStoreProvider>
        <SignatureBadge repoId={1} hash="b2" />
      </AppStoreProvider>,
    );
    await waitFor(() => expect(screen.queryByText("Verified")).not.toBeInTheDocument());
    expect(api.commitSignature).toHaveBeenLastCalledWith(1, "b2");
  });
});
