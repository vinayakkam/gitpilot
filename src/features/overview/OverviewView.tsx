import { ArrowRight, CircleAlert, FileDiff, GitCommitHorizontal, Server } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { absoluteTime, plural, relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { LfsCard } from "./LfsCard";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd className="selectable min-w-0 flex-1">{children}</dd>
    </div>
  );
}

export function OverviewView() {
  const { activeRepo, status, statusError, revision, setSection } = useStore();
  const id = activeRepo?.id;
  const log = useAsync(() => api.log(id!, { rev: null, skip: 0, limit: 8, search: null, path: null }), [id, revision, status?.branch.oid], id != null);
  const remotes = useAsync(() => api.remotes(id!), [id, revision], id != null);
  if (!activeRepo) return null;
  if (statusError) return <div className="p-6"><ErrorNotice error={statusError} /></div>;
  if (!status) return <div className="flex h-full items-center justify-center"><Spinner label="Reading repository" /></div>;

  const count = (a: string) => new Set(status.files.filter((f) => f.area === a).map((f) => f.path)).size;
  const staged = count("staged");
  const unstaged = count("unstaged");
  const untracked = count("untracked");
  const conflicted = count("conflicted");
  const b = status.branch;
  const latest = log.data?.commits[0];

  let sync: ReactNode;
  if (b.unborn) sync = <span className="text-muted">No commits yet</span>;
  else if (b.detached) sync = <span className="text-warning">Detached HEAD (not on a branch)</span>;
  else if (!b.upstream) sync = <span className="text-muted">Not published. There is no upstream branch configured.</span>;
  else {
    const a = b.ahead ?? 0;
    const be = b.behind ?? 0;
    const state = a && be ? `Diverged: ${a} ahead, ${be} behind` : a ? `${plural(a, "commit")} ahead` : be ? `${plural(be, "commit")} behind` : "Up to date";
    sync = (
      <>
        <span className={a && be ? "text-warning" : undefined}>{state}</span> <span className="text-muted">compared with</span>{" "}
        <span className="font-mono text-sm">{b.upstream}</span>
        <span className="block text-sm text-faint">
          {status.lastFetch ? `As of the last fetch, ${relativeTime(status.lastFetch)}.` : "Never fetched, so remote changes aren't known yet."}
        </span>
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-5">
        <h2 className="text-lg font-semibold">{activeRepo.name}</h2>
        <p className="selectable mt-0.5 truncate font-mono text-xs text-faint" title={activeRepo.path}>{activeRepo.path}</p>

        {conflicted > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded border border-conflict/40 bg-conflict-bg px-3 py-2 text-base">
            <CircleAlert size={15} className="text-conflict" />
            <span className="flex-1">{plural(conflicted, "file")} {conflicted === 1 ? "has" : "have"} merge conflicts.</span>
            <Button size="sm" onClick={() => setSection("changes")}>Resolve</Button>
          </div>
        )}

        <dl className="mt-4 text-base">
          <Row label="Branch"><span className="font-mono">{b.head ?? b.oid?.slice(0, 10) ?? "—"}</span></Row>
          <Row label="Sync">{sync}</Row>
          <Row label="Working tree">
            {status.files.length === 0 ? (
              <span className="text-muted">Clean. Nothing to commit.</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {staged > 0 && <span>{plural(staged, "staged file")}</span>}
                {unstaged > 0 && <span>{plural(unstaged, "modified file")}</span>}
                {untracked > 0 && <span>{plural(untracked, "new file")}</span>}
                {conflicted > 0 && <span className="text-conflict">{plural(conflicted, "conflict")}</span>}
                <button type="button" onClick={() => setSection("changes")} className="inline-flex items-center gap-1 text-accent-text hover:underline">
                  Review changes <ArrowRight size={12} />
                </button>
              </span>
            )}
          </Row>
          <Row label="Latest commit">
            {latest ? (
              <>
                <span>{latest.subject}</span>
                <span className="block text-sm text-faint">
                  <span className="font-mono">{latest.shortHash}</span> by {latest.authorName}, <span title={absoluteTime(latest.authorTime)}>{relativeTime(latest.authorTime)}</span>
                </span>
              </>
            ) : (
              <span className="text-muted">{log.loading ? "…" : "None yet"}</span>
            )}
          </Row>
          <Row label="Remotes">
            {remotes.data?.length ? (
              <span className="flex flex-col">
                {remotes.data.map((r) => (
                  <span key={r.name} className="truncate"><span className="font-mono">{r.name}</span> <span className="font-mono text-xs text-faint">{r.fetchUrl}</span></span>
                ))}
              </span>
            ) : (
              <button type="button" onClick={() => setSection("remotes")} className="inline-flex items-center gap-1 text-accent-text hover:underline">
                <Server size={12} /> Add a remote
              </button>
            )}
          </Row>
          <Row label="Large files">
            <LfsCard />
          </Row>
          {status.stashCount > 0 && <Row label="Stashes"><button type="button" className="text-accent-text hover:underline" onClick={() => setSection("branches")}>{plural(status.stashCount, "saved stash", "saved stashes")}</button></Row>}
        </dl>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-semibold">Recent commits</h3>
            {(log.data?.commits.length ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => setSection("history")}>Open history</Button>}
          </div>
          {log.error && <ErrorNotice className="mt-2" error={log.error} />}
          {log.data?.commits.length === 0 && (
            <EmptyState className="h-auto py-6" icon={<GitCommitHorizontal size={20} />} title="No commits yet" action={<Button icon={<FileDiff size={14} />} onClick={() => setSection("changes")}>Make the first commit</Button>}>
              Stage files in Changes and commit them to start the history.
            </EmptyState>
          )}
          <ol className="mt-2">
            {log.data?.commits.map((c) => (
              <li key={c.hash} className="flex items-baseline gap-3 border-b border-border py-1.5 text-base last:border-b-0">
                <span className="w-16 shrink-0 font-mono text-xs text-faint">{c.shortHash}</span>
                <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                <span className="shrink-0 text-sm text-faint">{c.authorName}</span>
                <span className="w-24 shrink-0 text-right text-sm text-faint" title={absoluteTime(c.authorTime)}>{relativeTime(c.authorTime)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
