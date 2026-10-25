import type { BranchInfo } from "@/bindings/BranchInfo";
import type { GitHubLink } from "@/bindings/GitHubLink";
import type { GitHubRepoRef } from "@/bindings/GitHubRepoRef";
import type { PullRequest } from "@/bindings/PullRequest";

/** The branch name on the remote, from an upstream like "origin/feature/x" and its remote "origin". */
export function remoteBranchName(upstream: string | null, remote: string | null): string | null {
  if (!upstream || !remote || !upstream.startsWith(`${remote}/`)) return null;
  return upstream.slice(remote.length + 1) || null;
}

/** Where the current branch is on GitHub: the repository owner and branch name, if it was pushed there. */
export function pushedAs(branch: BranchInfo | undefined, link: GitHubLink): { owner: string; branch: string } | null {
  const name = remoteBranchName(branch?.upstream ?? null, link.repo.remote);
  if (name) return { owner: link.repo.owner, branch: name };
  const parentName = remoteBranchName(branch?.upstream ?? null, link.parent?.remote ?? null);
  if (parentName && link.parent) return { owner: link.parent.owner, branch: parentName };
  return null;
}

/** The open pull request for the current branch, if there is one. */
export function pullForBranch(pulls: PullRequest[], branch: BranchInfo | undefined, link: GitHubLink): PullRequest | null {
  const p = pushedAs(branch, link);
  if (!p) return null;
  return pulls.find((pr) => pr.headRef === p.branch && (pr.headOwner ?? "").toLowerCase() === p.owner.toLowerCase()) ?? null;
}

/** The repository pull requests go to by default: the original for a fork, else the repository itself. */
export function defaultTarget(link: GitHubLink): GitHubRepoRef {
  return link.parent ?? link.repo;
}

/** A local ref for the base branch, used to work out what a pull request contains (e.g. "origin/main"). */
export function baseRef(target: GitHubRepoRef, link: GitHubLink, base: string): string | null {
  if (target.remote) return `${target.remote}/${base}`;
  // A fork's own default branch usually mirrors the original's.
  return link.repo.remote ? `${link.repo.remote}/${link.repo.defaultBranch}` : null;
}
