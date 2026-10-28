import type { GitHubLink } from "@/bindings/GitHubLink";
import type { PullRequest } from "@/bindings/PullRequest";
import { status } from "@/test/fixtures";
import { baseRef, defaultTarget, issueBranchName, issueFromBranch, pullForBranch, pushedAs, remoteBranchName } from "./pulls";

const repoRef = (owner: string, remote: string | null, defaultBranch = "main") => ({ owner, name: "app", fullName: `${owner}/app`, htmlUrl: `https://github.com/${owner}/app`, defaultBranch, remote });
const own: GitHubLink = { repo: repoRef("me", "origin"), parent: null, canPush: true };
const fork: GitHubLink = { repo: repoRef("me", "origin", "dev"), parent: repoRef("octo", "upstream"), canPush: true };
const pr = (n: number, headRef: string, headOwner: string | null): PullRequest => ({
  number: n, title: `PR ${n}`, url: `u${n}`, author: "a", draft: false, createdAt: "", updatedAt: "", headRef, headOwner, crossRepository: false, baseRef: "main", checks: null, review: null,
});
const branch = (upstream: string | null) => ({ ...status().branch, head: "feature/x", upstream });

describe("pull request helpers", () => {
  it("strips the remote from an upstream", () => {
    expect(remoteBranchName("origin/feature/x", "origin")).toBe("feature/x");
    expect(remoteBranchName("upstream/main", "origin")).toBeNull();
    expect(remoteBranchName(null, "origin")).toBeNull();
    expect(remoteBranchName("origin/x", null)).toBeNull();
  });

  it("finds where the branch was pushed, in the repo or its parent", () => {
    expect(pushedAs(branch("origin/feature/x"), fork)).toEqual({ owner: "me", branch: "feature/x" });
    expect(pushedAs(branch("upstream/feature/x"), fork)).toEqual({ owner: "octo", branch: "feature/x" });
    expect(pushedAs(branch(null), fork)).toBeNull();
  });

  it("matches the branch's pull request by branch and owner", () => {
    const list = [pr(1, "feature/x", "octo"), pr(2, "feature/x", "Me"), pr(3, "other", "me")];
    expect(pullForBranch(list, branch("origin/feature/x"), fork)?.number).toBe(2);
    expect(pullForBranch(list, branch(null), fork)).toBeNull();
    expect(pullForBranch([pr(4, "feature/x", null)], branch("origin/feature/x"), own)).toBeNull();
  });

  it("targets the original repository of a fork and finds a local base ref", () => {
    expect(defaultTarget(fork).fullName).toBe("octo/app");
    expect(defaultTarget(own).fullName).toBe("me/app");
    expect(baseRef(fork.parent!, fork, "main")).toBe("upstream/main");
    // No remote for the original: fall back to the fork's default branch.
    const noUpstream = { ...fork, parent: repoRef("octo", null) };
    expect(baseRef(noUpstream.parent, noUpstream, "main")).toBe("origin/dev");
    expect(baseRef(repoRef("x", null), { ...own, repo: repoRef("me", null) }, "main")).toBeNull();
  });
});

describe("issue branches", () => {
  it("names a branch after the issue", () => {
    expect(issueBranchName(123, "Crash when opening a repo with spaces!")).toBe("123-crash-when-opening-a-repo-with");
    expect(issueBranchName(7, "Ünïcode   & symbols…")).toBe("7-unicode-symbols");
    expect(issueBranchName(9, "!!!")).toBe("9");
  });

  it("finds the issue from a branch name", () => {
    expect(issueFromBranch("123-crash")).toBe(123);
    expect(issueFromBranch("feature/123-crash")).toBeNull();
    expect(issueFromBranch(null)).toBeNull();
  });
});
