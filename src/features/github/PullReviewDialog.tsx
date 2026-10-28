import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleDot, CircleMinus, CircleX, ExternalLink, MessageSquare, Sparkles } from "lucide-react";
import type { CheckRun } from "@/bindings/CheckRun";
import type { GitHubRepoRef } from "@/bindings/GitHubRepoRef";
import type { MergeMethod } from "@/bindings/MergeMethod";
import type { PullComment } from "@/bindings/PullComment";
import type { ReviewEvent } from "@/bindings/ReviewEvent";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Select, TextArea } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { ReleaseNotes } from "@/components/ui/ReleaseNotes";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import { DiffViewer, type DiffNote } from "@/features/diff/DiffViewer";
import { ExplainDialog, type ExplainRequest } from "@/features/assistant/ExplainDialog";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { relativeTime, splitPath } from "@/lib/format";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

type Tab = "files" | "conversation" | "checks";

const REVIEW_LABEL: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  APPROVED: { label: "approved", tone: "success" },
  CHANGES_REQUESTED: { label: "requested changes", tone: "danger" },
  COMMENTED: { label: "reviewed", tone: "neutral" },
  DISMISSED: { label: "review dismissed", tone: "neutral" },
};

/** Check results as icon + word, never colour alone. */
export function CheckResult({ result }: { result: string }) {
  const ok = result === "success";
  const bad = result === "failure" || result === "timedOut" || result === "cancelled" || result === "actionRequired";
  const pending = result === "pending";
  const Icon = ok ? CircleCheck : bad ? CircleX : pending ? CircleDot : CircleMinus;
  const words: Record<string, string> = { success: "Passed", failure: "Failed", timedOut: "Timed out", cancelled: "Cancelled", actionRequired: "Needs action", pending: "Running", skipped: "Skipped", neutral: "Neutral" };
  return (
    <span className={cx("inline-flex items-center gap-1 text-sm", ok ? "text-success" : bad ? "text-danger" : pending ? "text-warning" : "text-muted")}>
      <Icon size={13} aria-hidden />
      {words[result] ?? result}
    </span>
  );
}

/** Maps GitHub's file status to the status glyph used everywhere else. */
function change(status: string) {
  return status === "added" ? "added" : status === "removed" ? "deleted" : status === "renamed" ? "renamed" : "modified";
}

function Comment({ c }: { c: PullComment }) {
  const t = Date.parse(c.createdAt);
  const review = c.reviewState ? REVIEW_LABEL[c.reviewState] : undefined;
  return (
    <article className="rounded border border-border">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-sm">
        <MessageSquare size={13} className="text-faint" aria-hidden />
        <span className="font-medium">{c.author ?? "someone"}</span>
        {review && <Badge tone={review.tone}>{review.label}</Badge>}
        {c.path && (
          <span className="font-mono text-xs text-muted">
            {c.path}
            {c.line ? `:${c.line}` : ""}
          </span>
        )}
        <span className="flex-1" />
        {!Number.isNaN(t) && <span className="text-faint">{relativeTime(t / 1000)}</span>}
        <IconButton size="sm" label="Open on GitHub" icon={<ExternalLink size={12} />} onClick={() => void openLink(c.url)} />
      </header>
      {c.body.trim() ? <ReleaseNotes source={c.body} className="selectable px-3 py-2 text-base" /> : <p className="px-3 py-2 text-sm text-faint">No comment.</p>}
    </article>
  );
}

/** Line comments on `path` that still point at a line in the diff, for showing under that line. */
export function lineNotes(comments: PullComment[], path: string | undefined): DiffNote[] {
  if (!path) return [];
  return comments
    .filter((c) => c.kind === "reviewComment" && c.path === path && !c.outdated && c.line != null)
    .map((c) => ({ side: c.side === "LEFT" ? "old" : "new", line: c.line!, author: c.author, body: c.body }));
}

/** Review a pull request without leaving GitPilot: files, conversation, checks, review and merge. */
export function PullReviewDialog({ target, number, onClose, onChanged }: { target: GitHubRepoRef; number: number | null; onClose: () => void; onChanged: () => void }) {
  const { settings, saveSettings, notify, activeRepo } = useStore();
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const open = number !== null;
  const n = number ?? 0;
  const detail = useAsync(() => api.githubPullDetail(target.owner, target.name, n), [target.fullName, n], open);
  const d = detail.data;
  const [tab, setTab] = useState<Tab>("files");
  const files = useAsync(() => api.githubPullFiles(target.owner, target.name, n), [target.fullName, n], open && tab === "files");
  // The Files tab needs it too: line comments are shown under their lines.
  const talk = useAsync(() => api.githubPullConversation(target.owner, target.name, n), [target.fullName, n], open && (tab === "conversation" || tab === "files"));
  const checks = useAsync<CheckRun[]>(() => api.githubPullChecks(target.owner, target.name, d!.headSha), [target.fullName, d?.headSha], open && tab === "checks" && !!d);
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<ReviewEvent | null>(null);
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [confirm, setConfirm] = useState<"merge" | "deleteBranch" | null>(null);

  useEffect(() => {
    if (open) {
      setTab("files");
      setFile(null);
      setText("");
    }
  }, [open, n]);
  useEffect(() => {
    if (!file && files.data?.[0]) setFile(files.data[0].path);
  }, [files.data, file]);
  const selected = files.data?.find((f) => f.path === file) ?? null;
  const notes = useMemo(() => lineNotes(talk.data ?? [], selected?.path), [talk.data, selected?.path]);

  const send = async (event: ReviewEvent | "plain") => {
    setSending(event === "plain" ? "comment" : event);
    try {
      if (event === "plain") await api.githubPullComment(target.owner, target.name, n, text);
      else await api.githubPullReview(target.owner, target.name, n, event, text);
      notify({ tone: "success", title: event === "approve" ? `Approved #${n}` : event === "requestChanges" ? `Requested changes on #${n}` : "Comment posted" });
      setText("");
      void talk.reload();
      onChanged();
    } catch (e) {
      notify({ tone: "error", title: "GitHub didn't accept that", error: toAppError(e) });
    } finally {
      setSending(null);
    }
  };

  const canMerge = d?.state === "open" && !d.draft && d.mergeable === true;
  const mergeNote = !d
    ? ""
    : d.state !== "open"
      ? ""
      : d.draft
        ? "Drafts can't be merged. Mark it ready for review on GitHub first."
        : d.mergeable === null
          ? "GitHub is still checking whether this can be merged. Reload in a moment."
          : d.mergeable === false
            ? "This pull request has conflicts with its base branch. Resolve them first."
            : d.mergeableState === "blocked"
              ? "GitHub may refuse the merge: required reviews or checks are missing."
              : "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={1180}
      title={d ? `${d.title} #${d.number}` : `Pull request #${n}`}
      description={d ? `${d.author ?? "Someone"} wants to merge ${d.headRef} into ${d.baseRef} · ${d.changedFiles} files, +${d.additions} −${d.deletions}` : undefined}
      footer={
        <>
          {d && (
            <Button icon={<ExternalLink size={13} />} onClick={() => void openLink(d.url)}>
              Open on GitHub
            </Button>
          )}
          <span className="flex-1" />
          {d?.state === "merged" && !d.crossRepository && (
            <Button variant="danger-ghost" onClick={() => setConfirm("deleteBranch")}>
              Delete branch {d.headRef}
            </Button>
          )}
          {d?.state === "open" && (
            <>
              <Select aria-label="Merge method" value={method} onChange={(e) => setMethod(e.target.value as MergeMethod)} className="w-auto">
                <option value="merge">Create a merge commit</option>
                <option value="squash">Squash and merge</option>
                <option value="rebase">Rebase and merge</option>
              </Select>
              <Button variant="primary" disabled={!canMerge} onClick={() => setConfirm("merge")}>
                Merge
              </Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {detail.loading && !d ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner label="Loading the pull request" />
        </div>
      ) : detail.error ? (
        <ErrorNotice error={detail.error} />
      ) : d ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.state === "open" ? "success" : d.state === "merged" ? "accent" : "neutral"}>{d.state}</Badge>
            {d.draft && <Badge>draft</Badge>}
            {d.crossRepository && <Badge title="The changes come from another repository">from a fork</Badge>}
            <span className="flex-1" />
            {activeRepo && (
              <Button
                size="sm"
                icon={<Sparkles size={12} />}
                onClick={() => setExplain({ title: `Explain pull request #${n}`, load: () => api.aiExplain(activeRepo.id, { kind: "pullRequest", owner: target.owner, name: target.name, number: n }) })}
              >
                Explain
              </Button>
            )}
            <Segmented
              size="sm"
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                { value: "files", label: `Files (${d.changedFiles})` },
                { value: "conversation", label: "Conversation" },
                { value: "checks", label: "Checks" },
              ]}
            />
          </div>
          {mergeNote && <p className="text-sm text-warning">{mergeNote}</p>}

          {tab === "files" && (
            <div className="flex h-[52vh] min-h-0 overflow-hidden rounded border border-border">
              <div role="listbox" aria-label="Changed files" className="w-72 shrink-0 overflow-y-auto border-r border-border py-1">
                {files.loading && !files.data && <Spinner className="m-3" label="Loading files" />}
                {files.error && <ErrorNotice compact className="m-2" error={files.error} />}
                {files.data?.map((f) => {
                  const { name, dir } = splitPath(f.path);
                  return (
                    <div
                      key={f.path}
                      role="option"
                      aria-selected={f.path === file}
                      tabIndex={-1}
                      onClick={() => setFile(f.path)}
                      className={cx("mx-1 flex h-7 cursor-default items-center gap-2 rounded px-2", f.path === file ? "bg-selection" : "hover:bg-surface-2")}
                    >
                      <StatusGlyph change={change(f.status)} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {name} {dir && <span className="text-faint">{dir}</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-faint">
                        +{f.additions} −{f.deletions}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="min-w-0 flex-1">
                {selected && !selected.diff ? (
                  <EmptyState title="No preview from GitHub">GitHub doesn't send changes for binary or very large files. Check out the pull request to see the full diff.</EmptyState>
                ) : (
                  <DiffViewer
                    diff={selected?.diff ?? null}
                    loading={files.loading}
                    mode={settings?.diffMode ?? "unified"}
                    onModeChange={(m) => void saveSettings({ diffMode: m })}
                    highlight={settings?.syntaxHighlighting ?? true}
                    notes={notes}
                    emptyTitle="Select a file"
                  />
                )}
              </div>
            </div>
          )}

          {tab === "conversation" && (
            <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
              {d.body.trim() ? <Comment c={{ kind: "comment", author: d.author, body: d.body, createdAt: "", reviewState: null, path: null, line: null, side: null, outdated: false, url: d.url }} /> : <p className="text-sm text-faint">No description.</p>}
              {talk.loading && !talk.data && <Spinner label="Loading the conversation" />}
              {talk.error && <ErrorNotice error={talk.error} />}
              {talk.data?.map((c, i) => <Comment key={`${c.url}-${i}`} c={c} />)}
            </div>
          )}

          {tab === "checks" && (
            <div className="max-h-[52vh] overflow-y-auto rounded border border-border">
              {checks.loading && !checks.data && <Spinner className="m-3" label="Loading checks" />}
              {checks.error && <ErrorNotice className="m-2" error={checks.error} />}
              {checks.data?.length === 0 && <p className="px-3 py-2 text-sm text-muted">No checks ran on the latest commit.</p>}
              {checks.data?.map((c, i) => (
                <div key={`${c.name}-${i}`} className="flex h-9 items-center gap-3 border-b border-border px-3 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-base">{c.name}</span>
                  <CheckResult result={c.result} />
                  {c.url && <IconButton size="sm" label={`Open ${c.name} on GitHub`} icon={<ExternalLink size={12} />} onClick={() => void openLink(c.url!)} />}
                </div>
              ))}
            </div>
          )}

          {d.state === "open" && (
            <div className="flex flex-col gap-2">
              <TextArea aria-label="Your review" placeholder="Leave a comment (Markdown)" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={!text.trim() || !!sending} loading={sending === "comment"} onClick={() => void send("plain")}>
                  Comment
                </Button>
                <Button disabled={!text.trim() || !!sending} loading={sending === "requestChanges"} onClick={() => void send("requestChanges")}>
                  Request changes
                </Button>
                <Button disabled={!!sending} loading={sending === "approve"} onClick={() => void send("approve")}>
                  Approve
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <ExplainDialog request={explain} onClose={() => setExplain(null)} />
      <ConfirmDialog
        open={confirm === "merge"}
        onClose={() => setConfirm(null)}
        title={`Merge #${n} into ${d?.baseRef ?? "its base"}?`}
        confirmLabel="Merge"
        onConfirm={async () => {
          if (!d) return;
          try {
            await api.githubPullMerge(target.owner, target.name, n, method, d.headSha);
          } catch (e) {
            notify({ tone: "error", title: "Merge failed", error: toAppError(e) });
            throw e;
          }
          notify({ tone: "success", title: `Merged #${n}` });
          void detail.reload();
          onChanged();
        }}
      >
        <p>
          {method === "squash" ? "All commits are combined into one commit" : method === "rebase" ? "Each commit is replayed" : "A merge commit is created"} on {d?.baseRef} on GitHub. Only the commits you reviewed are merged: if someone pushed since, GitHub refuses.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "deleteBranch"}
        onClose={() => setConfirm(null)}
        danger
        title={`Delete ${d?.headRef ?? "the branch"} on GitHub?`}
        confirmLabel="Delete branch"
        onConfirm={async () => {
          if (!d) return;
          try {
            await api.githubPullDeleteBranch(target.owner, target.name, d.headRef);
          } catch (e) {
            notify({ tone: "error", title: "Couldn't delete the branch", error: toAppError(e) });
            throw e;
          }
          notify({ tone: "success", title: `Deleted ${d.headRef} on GitHub` });
        }}
      >
        <p>The pull request is merged, so its commits are on {d?.baseRef}. Your local branch, if any, isn't touched.</p>
      </ConfirmDialog>
    </Dialog>
  );
}
