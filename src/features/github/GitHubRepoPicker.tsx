import { useMemo, useState } from "react";
import { Archive, GitFork, Lock, RefreshCw } from "lucide-react";
import type { GitHubRepo } from "@/bindings/GitHubRepo";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Badge, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { GitHubAccountCard } from "./GitHubAccountCard";
import { useGitHubAccount } from "./useGitHubAccount";

export type Protocol = "https" | "ssh";

/** Shown at most, so a huge list stays fast; searching narrows it. */
const MAX_SHOWN = 200;

/** Repositories whose name or description contains every word of `query`. */
export function filterRepos(repos: GitHubRepo[], query: string): GitHubRepo[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return repos;
  return repos.filter((r) => {
    const hay = `${r.fullName} ${r.description ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The signed-in user's GitHub repositories, searchable. `onPick` gets the clone URL to use. */
export function GitHubRepoPicker({ onPick }: { onPick: (repo: GitHubRepo, url: string) => void }) {
  const account = useGitHubAccount();
  const signedIn = account.data?.user != null;
  const repos = useAsync(() => api.githubRepos(), [account.data?.user?.login], signedIn);
  const [query, setQuery] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("https");
  const shown = useMemo(() => filterRepos(repos.data ?? [], query), [repos.data, query]);

  if (account.loading && !account.data) return <Spinner label="Checking your GitHub sign-in" />;
  if (!signedIn) return <GitHubAccountCard compact />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchField className="flex-1" label="Search your repositories" placeholder="Search your repositories" value={query} onChange={setQuery} autoFocus />
        <Segmented
          size="sm"
          label="Clone with"
          value={protocol}
          onChange={setProtocol}
          options={[
            { value: "https", label: "HTTPS", title: "Uses your Git credential manager" },
            { value: "ssh", label: "SSH", title: "Uses your SSH keys" },
          ]}
        />
      </div>
      <div className="h-64 overflow-y-auto rounded border border-border" role="listbox" aria-label="Your GitHub repositories">
        {repos.loading && !repos.data && (
          <div className="flex justify-center p-6">
            <Spinner label="Loading your repositories" />
          </div>
        )}
        {repos.error && (
          <div className="flex flex-col gap-2 p-3">
            <ErrorNotice compact error={repos.error} />
            <div>
              <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => void repos.reload()}>
                Try again
              </Button>
            </div>
          </div>
        )}
        {repos.data && shown.length === 0 && <p className="p-4 text-center text-base text-muted">{query ? `No repositories match “${query}”.` : "You don't have any repositories yet."}</p>}
        {shown.slice(0, MAX_SHOWN).map((r) => (
          <button
            key={r.fullName}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(r, protocol === "ssh" && r.sshUrl ? r.sshUrl : r.cloneUrl)}
            className={cx("flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2")}
          >
            <span className="flex items-center gap-1.5 text-base">
              <span className="truncate font-medium">{r.fullName}</span>
              {r.private && (
                <Badge>
                  <Lock size={10} className="mr-0.5" /> private
                </Badge>
              )}
              {r.fork && (
                <Badge>
                  <GitFork size={10} className="mr-0.5" /> fork
                </Badge>
              )}
              {r.archived && (
                <Badge tone="warning">
                  <Archive size={10} className="mr-0.5" /> archived
                </Badge>
              )}
              {r.pushedAt && <span className="ml-auto shrink-0 text-xs text-faint">{relativeTime(Date.parse(r.pushedAt) / 1000)}</span>}
            </span>
            {r.description && <span className="truncate text-sm text-muted">{r.description}</span>}
          </button>
        ))}
        {shown.length > MAX_SHOWN && <p className="p-2 text-center text-sm text-faint">{shown.length - MAX_SHOWN} more. Search to narrow the list.</p>}
      </div>
    </div>
  );
}
