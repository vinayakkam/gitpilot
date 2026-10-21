import { useEffect, useRef, useState } from "react";
import { Sparkles, TriangleAlert, X } from "lucide-react";
import type { AiSuggestions } from "@/bindings/AiSuggestions";
import type { AppError } from "@/bindings/AppError";
import type { Identity } from "@/bindings/Identity";
import type { LastCommit } from "@/bindings/LastCommit";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, TextArea } from "@/components/ui/Field";
import { ErrorNotice, Kbd } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { hasMod, modKey } from "@/lib/platform";
import { useStore } from "@/store/AppStore";
import { LineEndingNotice } from "./LineEndingNotice";

const SUMMARY_LIMIT = 72;

/** For previews: joins lines the model wrapped at 72 columns, keeping paragraph breaks and lists. */
function reflow(body: string): string {
  return body.replace(/([^\n])\n(?![\n\-*•]|\d+[.)] )/g, "$1 ");
}

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: \S/;

// Drafts survive switching views and repositories (per repo, per session).
const drafts = new Map<number, { summary: string; body: string }>();
const DRAFT_EVENT = "gitpilot:commit-draft";

/** Splits a full commit message into summary and description. */
export function splitMessage(message: string): { summary: string; body: string } {
  const [first = "", ...rest] = message.replace(/\r\n/g, "\n").split("\n");
  return { summary: first.trim(), body: rest.join("\n").trim() };
}

/** Puts a message into a repository's commit box (used after undoing a commit). */
export function setCommitDraft(id: number, message: string) {
  drafts.set(id, splitMessage(message));
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: id }));
}

/** Takes back the last commit and puts its message back in the commit box. */
export async function undoLastCommit(id: number, confirmedPushed: boolean) {
  const message = await api.commitUndo(id, confirmedPushed);
  setCommitDraft(id, message);
  return message;
}

export function CommitComposer({ stagedCount }: { stagedCount: number }) {
  const { activeRepo, status, settings, run, busy, setPage, notify } = useStore();
  const id = activeRepo?.id;
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [ai, setAi] = useState<AiSuggestions | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<AppError | null>(null);
  const [commitError, setCommitError] = useState<AppError | null>(null);
  const [amend, setAmend] = useState<LastCommit | null>(null);
  const [confirmAmend, setConfirmAmend] = useState(false);
  const beforeAmend = useRef<{ summary: string; body: string } | null>(null);
  const summaryRef = useRef<HTMLInputElement>(null);

  // Another part of the app (e.g. Undo in History) can put a message here.
  useEffect(() => {
    const onDraft = (e: Event) => {
      const target = (e as CustomEvent<number>).detail;
      if (target !== id) return;
      const d = drafts.get(target);
      setAmend(null);
      setSummary(d?.summary ?? "");
      setBody(d?.body ?? "");
    };
    window.addEventListener(DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(DRAFT_EVENT, onDraft);
  }, [id]);

  useEffect(() => {
    if (id == null) return;
    const d = drafts.get(id);
    setSummary(d?.summary ?? "");
    setBody(d?.body ?? "");
    setAi(null);
    setAiError(null);
    setCommitError(null);
    setAmend(null);
    api.identityGet(id).then(setIdentity, () => setIdentity(null));
  }, [id]);

  useEffect(() => {
    // While amending, the box holds the old commit's message; keep the real draft untouched.
    if (id != null && !amend) drafts.set(id, { summary, body });
  }, [id, summary, body, amend]);

  const toggleAmend = async (on: boolean) => {
    if (!id) return;
    if (!on) {
      setAmend(null);
      const d = beforeAmend.current;
      setSummary(d?.summary ?? "");
      setBody(d?.body ?? "");
      return;
    }
    const last = await api.lastCommit(id).catch(() => null);
    if (!last) {
      notify({ tone: "info", title: "There's no commit to amend yet." });
      return;
    }
    beforeAmend.current = { summary, body };
    const m = splitMessage(last.message);
    setSummary(m.summary);
    setBody(m.body);
    setAmend(last);
    summaryRef.current?.focus();
  };

  const merging = status?.state === "merging";
  const missingIdentity = identity !== null && (!identity.name || !identity.email);
  const canCommit = !!summary.trim() && (stagedCount > 0 || merging || !!amend) && !busy;
  const branch = status?.branch.head;
  const over = summary.length - SUMMARY_LIMIT;
  const conventional = settings?.commitConvention === "conventional";
  const convOk = !conventional || !summary.trim() || CONVENTIONAL.test(summary.trim());

  const commit = async (confirmedPushed = false) => {
    if (!id || !canCommit) return;
    setCommitError(null);
    const message = body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim();
    if (amend) {
      if (amend.pushed && !confirmedPushed) {
        setConfirmAmend(true);
        return;
      }
      try {
        const hash = await run("Amend commit", () => api.commitAmend(id, message, confirmedPushed), { rethrow: true, quiet: true });
        if (hash) {
          setAmend(null);
          const d = beforeAmend.current;
          setSummary(d?.summary ?? "");
          setBody(d?.body ?? "");
          if (settings?.successNotifications !== false) notify({ tone: "success", title: `Amended ${hash.slice(0, 7)}`, body: amend.pushed ? "Push with force (with lease) to update the remote." : undefined });
        }
      } catch (e) {
        setCommitError(toAppError(e));
      }
      return;
    }
    try {
      const hash = await run("Commit", () => api.commit(id, message), { rethrow: true, quiet: true });
      if (hash) {
        setSummary("");
        setBody("");
        setAi(null);
        drafts.delete(id);
        notify({
          tone: "success",
          title: `Committed ${hash.slice(0, 7)}`,
          action: {
            label: "Undo",
            run: () =>
              void run("Undo commit", () => undoLastCommit(id, false)).then((m) => {
                if (m !== undefined) notify({ tone: "info", title: "Commit undone", body: "Its changes are staged again and the message is back in the commit box." });
              }),
          },
        });
      }
    } catch (e) {
      const err = toAppError(e);
      setCommitError(err);
      if (err.kind === "missingIdentity") setIdentityOpen(true);
    }
  };

  const suggest = async () => {
    if (!id) return;
    if (!settings?.ai.enabled) {
      setPage("settings");
      notify({ tone: "info", title: "Turn on AI suggestions in Settings → AI first." });
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAi(null);
    try {
      setAi(await api.aiSuggestCommit(id));
    } catch (e) {
      setAiError(toAppError(e));
    } finally {
      setAiLoading(false);
    }
  };

  const aiTip = !settings?.ai.enabled
    ? "AI suggestions are off. Click to set them up."
    : stagedCount === 0
      ? "Stage changes first. Suggestions use staged changes only."
      : "Suggest a message from the staged changes";

  return (
    <div
      className="relative shrink-0 border-t border-border bg-surface p-2.5"
      onKeyDown={(e) => {
        if (e.key === "Enter" && hasMod(e)) {
          e.preventDefault();
          void commit();
        }
      }}
    >
      {(ai || aiError || aiLoading) && (
        <div className="gp-pop absolute inset-x-2.5 bottom-full mb-2 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-surface shadow-overlay" role="region" aria-label="Suggested commit messages">
          <div className="flex h-9 items-center gap-2 border-b border-border pl-3 pr-1.5">
            <Sparkles size={13} className="text-accent-text" />
            <span className="flex-1 text-sm font-medium">{aiLoading ? "Reading staged changes…" : "Suggestions"}</span>
            {ai && <span className="text-xs text-faint">{ai.model}</span>}
            <button type="button" aria-label="Close suggestions" onClick={() => { setAi(null); setAiError(null); }} className="rounded p-1 text-faint hover:bg-surface-2 hover:text-text">
              <X size={13} />
            </button>
          </div>
          {aiLoading && <div className="flex justify-center p-4"><Spinner label="Generating suggestions" /></div>}
          {aiError && <ErrorNotice compact className="m-2" error={aiError} />}
          {ai && (
            <>
              <ul className="py-1">
                {ai.suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        setSummary(s.subject);
                        setBody(s.body);
                        setAi(null);
                        summaryRef.current?.focus();
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-surface-2"
                    >
                      <span className="block font-mono text-sm">{s.subject}</span>
                      {s.body && <span className="mt-0.5 block whitespace-pre-wrap text-sm text-muted">{reflow(s.body)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {(ai.excludedFiles.length > 0 || ai.truncated) && (
                <p className="border-t border-border px-3 py-1.5 text-xs text-muted">
                  {ai.excludedFiles.length > 0 && <>Not sent (may contain secrets): {ai.excludedFiles.join(", ")}. </>}
                  {ai.truncated && "The diff was shortened to fit the request limit."}
                </p>
              )}
              <p className="border-t border-border px-3 py-1.5 text-xs text-faint">Pick one to edit it. Nothing is committed until you press Commit.</p>
            </>
          )}
        </div>
      )}

      {missingIdentity && (
        <div className="mb-2 flex items-center gap-2 rounded border border-warning/30 bg-warning-bg px-2 py-1.5 text-sm">
          <TriangleAlert size={13} className="shrink-0 text-warning" />
          <span className="flex-1">Git needs your name and email before you can commit.</span>
          <Button size="sm" onClick={() => setIdentityOpen(true)}>
            Set identity
          </Button>
        </div>
      )}

      <LineEndingNotice stagedCount={stagedCount} />

      <div className="relative">
        <Input
          ref={summaryRef}
          aria-label="Commit summary"
          placeholder={conventional ? "feat: summary of the change" : "Summary of the change"}
          value={summary}
          onChange={(e) => setSummary(e.target.value.replace(/\n/g, " "))}
          aria-invalid={over > 0 || !convOk || undefined}
          className="pr-20 font-medium"
        />
        <div className="absolute right-1 top-0.5 flex items-center gap-1">
          <span className={cx("text-xs tabular-nums", over > 0 ? "text-warning" : "text-faint")} title="Recommended maximum: 72 characters">
            {SUMMARY_LIMIT - summary.length}
          </span>
          <Tooltip content={aiTip}>
            <button
              type="button"
              aria-label="Suggest a commit message with AI"
              onClick={suggest}
              disabled={aiLoading || (settings?.ai.enabled === true && stagedCount === 0)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-3 hover:text-accent-text disabled:opacity-40"
            >
              {aiLoading ? <Spinner size={12} /> : <Sparkles size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      {!convOk && <p className="mt-1 text-xs text-warning">Conventional format: type(scope): summary, e.g. “fix: handle missing Git executable”.</p>}
      <TextArea
        aria-label="Commit description (optional)"
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={body.split("\n").length > 3 ? 6 : 3}
        className="mt-1.5 text-sm"
      />
      {(status?.state ?? "normal") === "normal" && (
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Checkbox checked={!!amend} onChange={(v) => void toggleAmend(v)} label="Amend last commit" />
        {amend?.pushed && <span className="text-xs text-warning">Already pushed</span>}
      </div>
      )}
      {amend && (
        <p className="mt-1 text-xs text-muted">
          {stagedCount > 0 ? `Adds ${plural(stagedCount, "staged file")} to the last commit and` : "Replaces the last commit's message; staged changes would be added too. It"} replaces it instead of creating a new commit.
        </p>
      )}
      {commitError && <ErrorNotice compact className="mt-2" error={commitError} />}
      <Tooltip content={canCommit ? `${modKey}+Enter` : !summary.trim() ? "Write a summary first" : "Stage the changes you want to commit"}>
        <span className="mt-2 block">
          <Button variant="primary" className="w-full" disabled={!canCommit} loading={busy === "Commit" || busy === "Amend commit"} onClick={() => void commit()}>
            {amend
              ? "Amend last commit"
              : merging
              ? "Commit merge"
              : stagedCount === 0
                ? "No staged changes"
                : `Commit ${plural(stagedCount, "file")}${branch ? ` to ${branch}` : ""}`}
          </Button>
        </span>
      </Tooltip>
      {canCommit && (
        <p className="mt-1 text-center text-xs text-faint">
          <Kbd>{modKey}</Kbd> <Kbd>Enter</Kbd>
        </p>
      )}
      <ConfirmDialog
        open={confirmAmend}
        onClose={() => setConfirmAmend(false)}
        danger
        title="Amend a pushed commit?"
        confirmLabel="Amend anyway"
        onConfirm={async () => {
          setConfirmAmend(false);
          await commit(true);
        }}
      >
        <p>This commit is already on the remote. Amending replaces it with a new one, so you'll need to push with force (with lease), and anyone who pulled it will have to reconcile their copy.</p>
      </ConfirmDialog>
      <IdentityDialog open={identityOpen} onClose={() => setIdentityOpen(false)} initial={identity} onSaved={setIdentity} />
    </div>
  );
}

function IdentityDialog({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial: Identity | null; onSaved: (i: Identity) => void }) {
  const { activeRepo, refreshInfo } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<"repo" | "global">("repo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setEmail(initial?.email ?? "");
      setError(null);
    }
  }, [open, initial]);

  const save = async () => {
    if (!activeRepo) return;
    setBusy(true);
    setError(null);
    try {
      await api.identitySet(activeRepo.id, name, email, scope === "global");
      onSaved({ name, email });
      void refreshInfo();
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Set your Git identity"
      description="Git records this name and email in every commit you make."
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !email.includes("@")}>Save identity</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Use for</span>
          <Segmented
            label="Identity scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "repo", label: "This repository" },
              { value: "global", label: "All repositories" },
            ]}
          />
          <p className="text-sm text-muted">
            {scope === "global" ? "Writes user.name and user.email to your global Git config (~/.gitconfig)." : "Writes to this repository's .git/config only."}
          </p>
        </div>
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
