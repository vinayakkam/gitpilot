import { useEffect, useMemo, useState } from "react";
import { ArrowUpFromLine, Sparkles } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { CreatedPull } from "@/bindings/CreatedPull";
import type { GitHubLink } from "@/bindings/GitHubLink";
import type { GitHubRepoRef } from "@/bindings/GitHubRepoRef";
import type { PrDescription } from "@/bindings/PrDescription";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, TextArea } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { AiError, AiNote } from "@/features/assistant/AiNote";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { baseRef } from "./pulls";

/** Opens a pull request from the current branch into a branch of `target`. */
export function CreatePullRequestDialog({
  open,
  onClose,
  link,
  target,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  link: GitHubLink;
  target: GitHubRepoRef;
  onCreated: (pr: CreatedPull) => void;
}) {
  const { activeRepo, status, run, busy } = useStore();
  const id = activeRepo?.id;
  const [base, setBase] = useState(target.defaultBranch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [ai, setAi] = useState<PrDescription | null>(null);
  const [aiError, setAiError] = useState<AppError | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const branches = useAsync(() => api.branches(id!), [id, open], open && id != null);

  useEffect(() => {
    if (!open) return;
    setBase(target.defaultBranch);
    setTitle("");
    setBody("");
    setDraft(false);
    setError(null);
    setAi(null);
    setAiError(null);
  }, [open, target]);

  // Branch names on the target's remote, for suggestions in the "Into" field.
  const baseChoices = useMemo(() => {
    const r = target.remote;
    if (!r) return [];
    return (branches.data ?? []).filter((b) => b.isRemote && b.remote === r).map((b) => b.name.slice(r.length + 1)).filter((n) => n && n !== "HEAD");
  }, [branches.data, target.remote]);

  const b = status?.branch;
  const notPushed = !b?.upstream;
  const ahead = b?.ahead ?? 0;
  const needsPush = notPushed || ahead > 0;
  const ref = baseRef(target, link, base.trim() || target.defaultBranch);

  const push = () =>
    id != null &&
    void run("Push", () => api.push(id, notPushed ? { setUpstream: true, remote: link.repo.remote } : {}), {
      success: notPushed ? `Published ${b?.head ?? "branch"}` : "Pushed",
    });

  const writeWithAi = async () => {
    if (id == null || !ref) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const d = await api.aiPrDescription(id, ref);
      setAi(d);
      setTitle(d.title);
      setBody(d.body);
    } catch (e) {
      setAiError(toAppError(e));
    } finally {
      setAiLoading(false);
    }
  };

  const create = async () => {
    if (id == null || needsPush || !title.trim() || !base.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const pr = await api.githubPullCreate(id, target.owner, target.name, base.trim(), title.trim(), body, draft);
      onCreated(pr);
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={creating}
      width={640}
      title="Create a pull request"
      description={
        <>
          From <span className="font-mono">{b?.head}</span> into <span className="font-mono">{target.fullName}</span>
        </>
      }
      onSubmit={() => void create()}
      footer={
        <>
          <Button onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={creating} disabled={needsPush || !title.trim() || !base.trim()}>
            {draft ? "Create draft pull request" : "Create pull request"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {needsPush && (
          <div className="flex items-center gap-3 rounded border border-warning/40 bg-warning-bg px-3 py-2 text-base">
            <span className="flex-1">
              {notPushed ? "This branch isn't on GitHub yet. Publish it first." : `${plural(ahead, "commit")} ${ahead === 1 ? "isn't" : "aren't"} pushed yet. Push first so ${ahead === 1 ? "it's" : "they're"} included.`}
            </span>
            <Button size="sm" variant="primary" icon={<ArrowUpFromLine size={12} />} loading={busy === "Push"} disabled={!!busy} onClick={push}>
              {notPushed ? "Publish branch" : "Push"}
            </Button>
          </div>
        )}
        <Field label="Into branch" hint={`A branch of ${target.fullName}.`}>
          {(p) => (
            <>
              <Input {...p} list="gp-pr-bases" value={base} onChange={(e) => setBase(e.target.value)} className="font-mono text-sm" />
              <datalist id="gp-pr-bases">
                {baseChoices.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Title">{(p) => <Input {...p} autoFocus value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Description" hint="Markdown is supported.">
          {(p) => <TextArea {...p} rows={9} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" icon={<Sparkles size={12} />} loading={aiLoading} disabled={!ref} onClick={() => void writeWithAi()}>
            Write with AI
          </Button>
          <Checkbox checked={draft} onChange={setDraft} label="Draft (not ready for review yet)" />
        </div>
        {aiError && <AiError error={aiError} onSetUp={onClose} />}
        {ai && <AiNote model={ai.model} excludedFiles={ai.excludedFiles} truncated={ai.truncated} />}
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
