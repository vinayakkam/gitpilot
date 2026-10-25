import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GitHubRepo } from "@/bindings/GitHubRepo";
import { Toaster } from "@/components/layout/Toaster";
import { AppStoreProvider } from "@/store/AppStore";
import { repo, settings, status } from "@/test/fixtures";
import { filterRepos, GitHubRepoPicker } from "./GitHubRepoPicker";
import { PullRequestsView } from "./PullRequestsView";
import { SignInDialog } from "./SignInDialog";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  repoList: vi.fn(),
  appInfo: vi.fn(),
  repoOpen: vi.fn(),
  status: vi.fn(),
  githubAccount: vi.fn(),
  githubDeviceStart: vi.fn(),
  githubDeviceWait: vi.fn(),
  githubTokenSet: vi.fn(),
  githubRepos: vi.fn(),
  githubLink: vi.fn(),
  githubPulls: vi.fn(),
  githubPullCreate: vi.fn(),
  githubPullCheckout: vi.fn(),
  aiPrDescription: vi.fn(),
  branches: vi.fn(),
  push: vi.fn(),
  opCancel: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api, onProgress: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

const signedOut = { user: null, tokenSource: null, tokenRejected: false, keychainAvailable: true, deviceFlow: true };
const signedIn = { ...signedOut, user: { login: "me", name: "Me", htmlUrl: "https://github.com/me" }, tokenSource: "keychain" };
const ghRepo = (fullName: string, description: string | null = null): GitHubRepo => {
  const [owner = "", name = ""] = fullName.split("/");
  return { fullName, owner, name, description, private: false, fork: false, archived: false, cloneUrl: `https://github.com/${fullName}.git`, sshUrl: `git@github.com:${fullName}.git`, htmlUrl: `https://github.com/${fullName}`, pushedAt: null };
};
const ref = (owner: string, remote: string | null) => ({ owner, name: "app", fullName: `${owner}/app`, htmlUrl: `https://github.com/${owner}/app`, defaultBranch: "main", remote });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.settingsGet.mockResolvedValue(settings);
  api.repoList.mockResolvedValue([repo]);
  api.appInfo.mockResolvedValue({ version: "0.4.2", os: "linux", gitPath: "git", gitVersion: "2.43.0", gitError: null, globalIdentity: null, dataDir: "/d" });
  api.repoOpen.mockResolvedValue(repo);
  api.status.mockResolvedValue({ ...status([]), branch: { ...status().branch, head: "feature", upstream: "origin/feature" } });
  api.githubAccount.mockResolvedValue(signedIn);
  api.branches.mockResolvedValue([]);
  api.opCancel.mockResolvedValue(true);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

const inStore = (ui: React.ReactNode) =>
  render(
    <AppStoreProvider>
      {ui}
      <Toaster />
    </AppStoreProvider>,
  );

describe("GitHubRepoPicker", () => {
  it("filters by every word in name or description", () => {
    const list = [ghRepo("me/web-app", "Company website"), ghRepo("octo/cli"), ghRepo("me/api", "Web API")];
    expect(filterRepos(list, "web").map((r) => r.fullName)).toEqual(["me/web-app", "me/api"]);
    expect(filterRepos(list, "ME   api").map((r) => r.fullName)).toEqual(["me/api"]);
    expect(filterRepos(list, " ")).toHaveLength(3);
  });

  it("picks a repository with the chosen protocol", async () => {
    api.githubRepos.mockResolvedValue([ghRepo("me/web-app"), ghRepo("octo/cli")]);
    const onPick = vi.fn();
    inStore(<GitHubRepoPicker onPick={onPick} />);
    expect(await screen.findByText("me/web-app")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search your repositories"), { target: { value: "cli" } });
    expect(screen.queryByText("me/web-app")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "SSH" }));
    fireEvent.click(screen.getByText("octo/cli"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ fullName: "octo/cli" }), "git@github.com:octo/cli.git");
  });

  it("asks to sign in first", async () => {
    api.githubAccount.mockResolvedValue(signedOut);
    inStore(<GitHubRepoPicker onPick={() => {}} />);
    expect(await screen.findByRole("button", { name: "Sign in to GitHub" })).toBeInTheDocument();
    expect(api.githubRepos).not.toHaveBeenCalled();
  });
});

describe("SignInDialog", () => {
  it("signs in with a token", async () => {
    api.githubTokenSet.mockResolvedValue(signedIn.user);
    const onClose = vi.fn();
    inStore(<SignInDialog open onClose={onClose} deviceFlow={false} />);
    fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "ghp_abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(api.githubTokenSet).toHaveBeenCalledWith("ghp_abc"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the device code, and cancelling stops the wait", async () => {
    api.githubDeviceStart.mockResolvedValue({ userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900 });
    api.githubDeviceWait.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    inStore(<SignInDialog open onClose={onClose} deviceFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Continue in browser" }));
    expect(await screen.findByLabelText("Sign-in code")).toHaveTextContent("WDJB-MJHT");
    expect(api.githubDeviceWait).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.opCancel).toHaveBeenCalledWith("github-login");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PullRequestsView", () => {
  it("explains when no remote is on GitHub", async () => {
    api.githubLink.mockResolvedValue(null);
    inStore(<PullRequestsView />);
    expect(await screen.findByText("This repository isn't on GitHub")).toBeInTheDocument();
  });

  it("lists pull requests with checks, and checks one out", async () => {
    api.githubLink.mockResolvedValue({ repo: ref("me", "origin"), parent: null, canPush: true });
    api.githubPulls.mockResolvedValue([
      { number: 7, title: "Add login", url: "https://github.com/me/app/pull/7", author: "ann", draft: false, createdAt: "", updatedAt: "2026-10-20T00:00:00Z", headRef: "login", headOwner: "ann", crossRepository: true, baseRef: "main", checks: "failing", review: "approved" },
    ]);
    api.githubPullCheckout.mockResolvedValue({ branch: "pr-7", created: true, updated: false, diverged: false });
    inStore(<PullRequestsView />);
    expect(await screen.findByText("Add login")).toBeInTheDocument();
    expect(api.githubPulls).toHaveBeenCalledWith("me", "app");
    expect(screen.getByText("Checks failed")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("ann:login → main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(api.githubPullCheckout).toHaveBeenCalledWith(1, "me", "app", 7));
    expect(await screen.findByText("Checked out #7 as pr-7")).toBeInTheDocument();
  });

  it("creates a pull request into the original repository of a fork, with an AI description", async () => {
    api.githubLink.mockResolvedValue({ repo: ref("me", "origin"), parent: ref("octo", "upstream"), canPush: true });
    api.githubPulls.mockResolvedValue([]);
    api.aiPrDescription.mockResolvedValue({ title: "Add feature", body: "## Changes\n- x", excludedFiles: [], truncated: false, model: "acme/large" });
    api.githubPullCreate.mockResolvedValue({ number: 12, url: "https://github.com/octo/app/pull/12" });
    inStore(<PullRequestsView />);
    expect(await screen.findByText("No open pull requests")).toBeInTheDocument();
    expect(api.githubPulls).toHaveBeenCalledWith("octo", "app");
    fireEvent.click(screen.getByRole("button", { name: "Create pull request" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Write with AI" }));
    await waitFor(() => expect(api.aiPrDescription).toHaveBeenCalledWith(1, "upstream/main"));
    expect(await within(dialog).findByDisplayValue("Add feature")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create draft pull request" }));
    await waitFor(() => expect(api.githubPullCreate).toHaveBeenCalledWith(1, "octo", "app", "main", "Add feature", "## Changes\n- x", true));
  });

  it("asks to push unpushed commits before creating", async () => {
    api.status.mockResolvedValue({ ...status([]), branch: { ...status().branch, head: "feature", upstream: null, ahead: null } });
    api.githubLink.mockResolvedValue({ repo: ref("me", "origin"), parent: null, canPush: true });
    api.githubPulls.mockResolvedValue([]);
    api.push.mockResolvedValue(undefined);
    inStore(<PullRequestsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Create pull request" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/isn't on GitHub yet/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "x" } });
    expect(within(dialog).getByRole("button", { name: "Create pull request" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish branch" }));
    await waitFor(() => expect(api.push).toHaveBeenCalledWith(1, { setUpstream: true, remote: "origin" }));
  });
});
