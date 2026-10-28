import { useMemo, useState } from "react";
import { CircleDot, ExternalLink, GitBranchPlus, MessageSquare, Plus, RefreshCw } from "lucide-react";
import type { GitHubRepoRef } from "@/bindings/GitHubRepoRef";
import type { Issue } from "@/bindings/Issue";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, TextArea } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { SearchField } from "@/components/ui/SearchField";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { issueBranchName } from "./pulls";

/** Text search over number, title, labels, author and assignees. */
export function filterIssues(issues: Issue[], q: string): Issue[] {
  const f = q.trim().toLowerCase().replace(/^#/, "");
  if (!f) return issues;
  return issues.filter((i) => String(i.number) === f || [i.title, i.author ?? "", ...i.labels, ...i.assignees].some((s) => s.toLowerCase().includes(f)));
}

/** Open issues of a GitHub repository, with Start work (a branch named after the issue) and New issue. */
export function IssuesList({ target }: { target: GitHubRepoRef }) {
  const { activeRepo, status, run, busy, notify } = useStore();
  const id = activeRepo?.id;
  const issues = useAsync(() => api.githubIssues(target.owner, target.name), [target.fullName]);
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterIssues(issues.data ?? [], q), [issues.data, q]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  // From the remote's default branch when this repository has the target as a remote.
  const start = (i: Issue) => {
    if (id == null) return;
    const name = issueBranchName(i.number, i.title);
    const from = target.remote ? `${target.remote}/${target.defaultBranch}` : null;
    void run("Create branch", () => api.branchCreate(id, name, from, true), { success: `Switched to ${name}, a new branch for #${i.number}` });
  };

  const create = async () => {
    setSaving(true);
    try {
      const i = await api.githubIssueCreate(target.owner, target.name, title, body);
      notify({ tone: "success", title: `Opened issue #${i.number}`, action: { label: "Open", run: () => void openLink(i.url) } });
      setCreating(false);
      setTitle("");
      setBody("");
      void issues.reload();
    } catch (e) {
      notify({ tone: "error", title: "Couldn't open the issue", error: toAppError(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Open issues" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField label="Search issues" placeholder="Search by title, #number, label or person" value={q} onChange={setQ} />
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void issues.reload()}>
          Refresh
        </Button>
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
          New issue
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        {issues.loading && !issues.data && (
          <div className="flex justify-center p-6">
            <Spinner label="Loading issues" />
          </div>
        )}
        {issues.error && <ErrorNotice className="m-3" error={issues.error} />}
        {issues.data && shown.length === 0 && (
          <EmptyState className="h-auto" icon={<CircleDot size={22} />} title={q ? "No matching issues" : "No open issues"}>
            {q ? `Nothing matches “${q}”.` : `Issues opened on ${target.fullName} show up here.`}
          </EmptyState>
        )}
        {shown.map((i) => {
          const t = Date.parse(i.updatedAt);
          return (
            <div key={i.number} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <CircleDot size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="selectable text-base font-medium">{i.title}</span>
                  <span className="text-sm text-faint">#{i.number}</span>
                  {i.labels.map((l) => (
                    <Badge key={l}>{l}</Badge>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {i.author && <span>by {i.author}</span>}
                  {i.assignees.length > 0 && <span>assigned to {i.assignees.join(", ")}</span>}
                  {!Number.isNaN(t) && <span>updated {relativeTime(t / 1000)}</span>}
                  {i.comments > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare size={12} aria-hidden /> {i.comments}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" icon={<GitBranchPlus size={12} />} disabled={!!busy || status?.state !== "normal" || status?.branch.unborn} onClick={() => start(i)}>
                  Start work
                </Button>
                <IconButton size="sm" label="Open on GitHub" icon={<ExternalLink size={13} />} onClick={() => void openLink(i.url)} />
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        width={560}
        busy={saving}
        title={`New issue in ${target.fullName}`}
        onSubmit={() => void create()}
        footer={
          <>
            <Button onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
              Open issue
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Title">{(p) => <Input {...p} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Description" hint="Markdown.">
            {(p) => <TextArea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </section>
  );
}
