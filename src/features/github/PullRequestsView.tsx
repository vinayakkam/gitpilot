import { useMemo, useState } from "react";
import { CircleCheck, CircleDot, CircleX, ExternalLink, GitPullRequest, GitPullRequestArrow, Plus, RefreshCw, Server } from "lucide-react";
import type { GitHubRepoRef } from "@/bindings/GitHubRepoRef";
import type { PullRequest } from "@/bindings/PullRequest";
import type { ReviewState } from "@/bindings/ReviewState";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { CreatePullRequestDialog } from "./CreatePullRequestDialog";
import { PullReviewDialog } from "./PullReviewDialog";
import { IssuesList } from "./IssuesList";
import { GitHubAccountCard } from "./GitHubAccountCard";
import { defaultTarget, pullForBranch } from "./pulls";
import { useGitHubAccount } from "./useGitHubAccount";

const REVIEW: Record<ReviewState, { label: string; tone: "success" | "danger" | "neutral" }> = {
  approved: { label: "Approved", tone: "success" },
  changesRequested: { label: "Changes requested", tone: "danger" },
  reviewRequired: { label: "Review required", tone: "neutral" },
};

/** Check results as icon + word, never colour alone. */
export function ChecksBadge({ checks }: { checks: PullRequest["checks"] }) {
  if (checks === "passing")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success">
        <CircleCheck size={13} aria-hidden /> Checks passed
      </span>
    );
  if (checks === "failing")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-danger">
        <CircleX size={13} aria-hidden /> Checks failed
      </span>
    );
  if (checks === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-warning">
        <CircleDot size={13} aria-hidden /> Checks running
      </span>
    );
  return null;
}

function PullRow({ pr, onCheckout, onReview, checkoutDisabled }: { pr: PullRequest; onCheckout: () => void; onReview: () => void; checkoutDisabled: boolean }) {
  const updated = Date.parse(pr.updatedAt);
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <GitPullRequest size={16} className={pr.draft ? "mt-0.5 shrink-0 text-faint" : "mt-0.5 shrink-0 text-success"} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="selectable text-base font-medium">{pr.title}</span>
          <span className="text-sm text-faint">#{pr.number}</span>
          {pr.draft && <Badge>draft</Badge>}
          {pr.review && <Badge tone={REVIEW[pr.review].tone}>{REVIEW[pr.review].label}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="font-mono text-xs">
            {pr.crossRepository && pr.headOwner ? `${pr.headOwner}:` : ""}
            {pr.headRef} → {pr.baseRef}
          </span>
          {pr.author && <span>by {pr.author}</span>}
          {!Number.isNaN(updated) && <span>updated {relativeTime(updated / 1000)}</span>}
          <ChecksBadge checks={pr.checks} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onReview}>
          Review
        </Button>
        <Button size="sm" disabled={checkoutDisabled} onClick={onCheckout}>
          Check out
        </Button>
        <IconButton size="sm" label="Open on GitHub" icon={<ExternalLink size={13} />} onClick={() => void openLink(pr.url)} />
      </div>
    </div>
  );
}

export function PullRequestsView() {
  const { activeRepo, status, run, busy, notify, setSection } = useStore();
  const id = activeRepo?.id;
  const account = useGitHubAccount();
  const signedIn = account.data?.user != null;
  const link = useAsync(() => api.githubLink(id!), [id, account.data?.user?.login], id != null && signedIn);
  const [which, setWhich] = useState<"parent" | "repo">("parent");
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [tab, setTab] = useState<"pulls" | "issues">("pulls");

  const l = link.data;
  const target: GitHubRepoRef | null = useMemo(() => {
    if (!l) return null;
    return which === "repo" || !l.parent ? l.repo : defaultTarget(l);
  }, [l, which]);
  const pulls = useAsync(() => api.githubPulls(target!.owner, target!.name), [target?.fullName], target != null);

  if (!activeRepo || id == null) return null;

  const header = (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Pull requests</h2>
      {target && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void pulls.reload()}>
            Refresh
          </Button>
          <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => void openLink(`${target.htmlUrl}/pulls`)}>
            On GitHub
          </Button>
        </div>
      )}
    </div>
  );

  let body;
  if (account.loading && !account.data) {
    body = <Spinner label="Checking your GitHub sign-in" />;
  } else if (!signedIn) {
    body = <GitHubAccountCard />;
  } else if (link.loading && !l) {
    body = <Spinner label="Looking up the repository on GitHub" />;
  } else if (link.error) {
    body = (
      <div className="flex flex-col gap-2">
        <ErrorNotice error={link.error} />
        <div>
          <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => void link.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else if (!l || !target) {
    body = (
      <EmptyState className="h-auto rounded-md border border-border" icon={<Server size={22} />} title="This repository isn't on GitHub" action={<Button onClick={() => setSection("remotes")}>Remotes</Button>}>
        None of its remotes point at github.com. Add a GitHub remote to see and open pull requests here.
      </EmptyState>
    );
  } else {
    const b = status?.branch;
    const mine = pulls.data ? pullForBranch(pulls.data, b, l) : null;
    const onBase = b?.head === target.defaultBranch && (target === l.repo || !l.parent);
    const canCreate = b && !b.detached && !b.unborn && b.head != null && !onBase;
    const checkout = (pr: PullRequest) =>
      void run(`Check out #${pr.number}`, () => api.githubPullCheckout(id, target.owner, target.name, pr.number)).then((c) => {
        if (!c) return;
        notify({
          tone: c.diverged ? "info" : "success",
          title: c.created ? `Checked out #${pr.number} as ${c.branch}` : c.updated ? `Updated ${c.branch} to the latest of #${pr.number}` : `Switched to ${c.branch}`,
          body: c.diverged ? `${c.branch} has commits that aren't in the pull request, so it wasn't updated.` : undefined,
        });
      });

    body = (
      <>
        {l.parent && (
          <div className="flex items-center gap-3 text-base">
            <span className="text-muted">Show pull requests for</span>
            <Segmented
              size="sm"
              label="Repository"
              value={which}
              onChange={setWhich}
              options={[
                { value: "parent", label: l.parent.fullName, title: "The repository yours was forked from" },
                { value: "repo", label: l.repo.fullName, title: "Your fork" },
              ]}
            />
          </div>
        )}

        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: "pulls", label: "Pull requests" },
            { value: "issues", label: "Issues" },
          ]}
        />
        {tab === "issues" && <IssuesList target={target} />}
        {tab === "pulls" && (
          <>
            <section aria-label="Current branch" className="rounded-md border border-border px-4 py-3">
              {!canCreate ? (
                <p className="text-base text-muted">
                  {b?.detached ? "Switch to a branch to open a pull request from it." : onBase ? `You're on ${target.defaultBranch}, the default branch. Create a branch for your change to open a pull request.` : "Commit something first to open a pull request."}
                </p>
              ) : mine ? (
                <div className="flex items-center gap-3">
                  <GitPullRequestArrow size={16} className="shrink-0 text-success" aria-hidden />
                  <p className="min-w-0 flex-1 text-base">
                    <span className="font-mono">{b.head}</span> has a pull request: <span className="font-medium">{mine.title}</span> <span className="text-faint">#{mine.number}</span>
                  </p>
                  <ChecksBadge checks={mine.checks} />
                  <Button size="sm" onClick={() => setReviewing(mine.number)}>
                    Review
                  </Button>
                  <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => void openLink(mine.url)}>
                    Open
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-base">
                    Ready to share <span className="font-mono">{b.head}</span>? Open a pull request into <span className="font-mono">{target.fullName}</span>.
                  </p>
                  <Button variant="primary" icon={<Plus size={14} />} disabled={pulls.loading && !pulls.data} onClick={() => setCreating(true)}>
                    Create pull request
                  </Button>
                </div>
              )}
            </section>

            <section aria-label="Open pull requests" className="overflow-hidden rounded-md border border-border">
              {pulls.loading && !pulls.data && (
                <div className="flex justify-center p-6">
                  <Spinner label="Loading pull requests" />
                </div>
              )}
              {pulls.error && <ErrorNotice className="m-3" error={pulls.error} />}
              {pulls.data?.length === 0 && (
                <EmptyState className="h-auto" icon={<GitPullRequest size={22} />} title="No open pull requests">
                  Pull requests opened on {target.fullName} show up here.
                </EmptyState>
              )}
              {pulls.data?.map((pr) => (
                <PullRow key={pr.number} pr={pr} onCheckout={() => checkout(pr)} onReview={() => setReviewing(pr.number)} checkoutDisabled={!!busy || status?.state !== "normal"} />
              ))}
            </section>
          </>
        )}

        <PullReviewDialog target={target} number={reviewing} onClose={() => setReviewing(null)} onChanged={() => void pulls.reload()} />
        <CreatePullRequestDialog
          open={creating}
          onClose={() => setCreating(false)}
          link={l}
          target={target}
          onCreated={(pr) => {
            notify({ tone: "success", title: `Opened pull request #${pr.number}`, action: { label: "Open", run: () => void openLink(pr.url) } });
            void pulls.reload();
          }}
        />
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-5">
        {header}
        {body}
      </div>
    </div>
  );
}
