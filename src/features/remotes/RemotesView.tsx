import { useState } from "react";
import { ArrowUpFromLine, KeyRound, Pencil, Plus, RefreshCw, Server, ShieldAlert, Trash2 } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { Remote } from "@/bindings/Remote";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Badge, EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural, relativeTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { SubmodulesSection } from "./SubmodulesSection";

function hostOf(url: string): string | null {
  const m = url.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i) ?? url.match(/^[^@\s]+@([^:]+):/);
  return m?.[1] ?? null;
}

function RemoteDialog({ initial, onClose }: { initial: Remote | null; onClose: () => void }) {
  const { activeRepo, run } = useStore();
  const [name, setName] = useState(initial?.name ?? "origin");
  const [url, setUrl] = useState(initial && !initial.hasCredentials ? initial.fetchUrl : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const nameProblem = name && !/^[A-Za-z0-9._/-]+$/.test(name) ? "Use letters, numbers, '.', '_', '-' or '/'." : null;
  const save = async () => {
    if (!activeRepo || !name.trim() || !url.trim() || nameProblem) return;
    setBusy(true);
    setError(null);
    try {
      await run(
        initial ? "Update remote" : "Add remote",
        () => (initial ? api.remoteSetUrl(activeRepo.id, initial.name, url.trim()) : api.remoteAdd(activeRepo.id, name.trim(), url.trim())),
        { rethrow: true, quiet: true, success: initial ? `Updated ${initial.name}` : `Added ${name.trim()}` },
      );
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={initial ? `Edit ${initial.name}` : "Add a remote"}
      description="Any Git server works: GitHub, GitLab, Bitbucket, a self-hosted server, or a path on disk."
      onSubmit={save}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !url.trim() || !!nameProblem}>{initial ? "Save" : "Add remote"}</Button></>}
    >
      <div className="flex flex-col gap-3">
        {!initial && <Field label="Name" error={nameProblem} hint="“origin” is the usual name for your main remote.">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />}</Field>}
        <Field
          label="URL"
          hint={initial?.hasCredentials ? "The current URL contains a saved credential, so it isn't shown. Enter the full new URL." : "https://host/owner/repo.git or git@host:owner/repo.git"}
        >
          {(p) => <Input {...p} autoFocus value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-sm" placeholder="https://…" />}
        </Field>
        {/^https?:\/\/[^/@]+:[^/@]+@/.test(url) && (
          <p className="flex items-start gap-1.5 text-sm text-warning"><KeyRound size={13} className="mt-0.5 shrink-0" />This URL contains a password or token. It will be stored in plain text in .git/config. A credential helper is safer.</p>
        )}
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}

export function RemotesView() {
  const { activeRepo, status, revision, run, busy } = useStore();
  const id = activeRepo?.id;
  const remotes = useAsync(() => api.remotes(id!), [id, revision], id != null);
  const [edit, setEdit] = useState<Remote | "new" | null>(null);
  const [remove, setRemove] = useState<Remote | null>(null);
  const [force, setForce] = useState(false);

  if (!activeRepo || id == null) return null;
  const b = status?.branch;

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Remotes</h2>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEdit("new")}>Add remote</Button>
        </div>

        <div className="mt-4 overflow-hidden rounded-md border border-border">
          {remotes.loading && !remotes.data && <div className="flex justify-center p-6"><Spinner label="Loading remotes" /></div>}
          {remotes.error && <ErrorNotice className="m-3" error={remotes.error} />}
          {remotes.data?.length === 0 && (
            <EmptyState className="h-auto" icon={<Server size={22} />} title="No remotes configured" action={<Button icon={<Plus size={14} />} onClick={() => setEdit("new")}>Add remote</Button>}>
              A remote is a copy of this repository on a server. Add one to push your commits and collaborate.
            </EmptyState>
          )}
          {remotes.data?.map((r) => (
            <div key={r.name} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <Server size={16} className="mt-0.5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-medium">{r.name}</span>
                  {hostOf(r.fetchUrl) && <span className="text-sm text-faint">{hostOf(r.fetchUrl)}</span>}
                  {r.hasCredentials && <Badge tone="warning" title="The URL embeds a credential; it is never displayed">credential in URL</Badge>}
                </div>
                <div className="selectable mt-1 grid grid-cols-[44px_1fr] gap-x-2 text-sm">
                  <span className="text-muted">Fetch</span><span className="truncate font-mono text-xs leading-5">{r.fetchUrl}</span>
                  {r.pushUrl !== r.fetchUrl && <><span className="text-muted">Push</span><span className="truncate font-mono text-xs leading-5">{r.pushUrl}</span></>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" icon={<RefreshCw size={12} />} disabled={!!busy} loading={busy === `Fetch ${r.name}`} onClick={() => void run(`Fetch ${r.name}`, () => api.fetch(id, r.name), { success: `Fetched ${r.name}` })}>Fetch</Button>
                <IconButton size="sm" label={`Edit ${r.name}`} icon={<Pencil size={13} />} onClick={() => setEdit(r)} />
                <IconButton size="sm" tone="danger" label={`Remove ${r.name}…`} icon={<Trash2 size={13} />} onClick={() => setRemove(r)} />
              </div>
            </div>
          ))}
        </div>

        {b && !b.unborn && !b.detached && (
          <section className="mt-8">
            <h3 className="text-md font-semibold">Current branch</h3>
            <div className="mt-2 rounded-md border border-border px-4 py-3 text-base">
              <p>
                <span className="font-mono font-medium">{b.head}</span>{" "}
                {b.upstream ? (
                  <>tracks <span className="font-mono">{b.upstream}</span>. {b.ahead || b.behind ? `${plural(b.ahead ?? 0, "commit")} to push, ${plural(b.behind ?? 0, "commit")} to pull` : "In sync"} as of the last fetch{status?.lastFetch ? ` (${relativeTime(status.lastFetch)})` : ""}.</>
                ) : (
                  <span className="text-muted">isn't published yet. Use Publish branch in the toolbar to push it and track it.</span>
                )}
              </p>
              {b.upstream && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-default text-muted hover:text-text">Advanced: force push</summary>
                  <div className="mt-2 flex items-start gap-3 rounded border border-danger/30 bg-removed-bg p-3">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
                    <div className="flex-1">
                      <p>Force pushing replaces the remote branch with your local one. Commits on the remote that you don't have are lost for everyone. GitPilot uses <code className="font-mono">--force-with-lease</code>, which refuses if the remote changed since your last fetch.</p>
                      <Button className="mt-2" size="sm" variant="danger" icon={<ArrowUpFromLine size={12} />} disabled={!!busy} onClick={() => setForce(true)}>Force push…</Button>
                    </div>
                  </div>
                </details>
              )}
            </div>
          </section>
        )}

        <SubmodulesSection />
      </div>

      {edit && <RemoteDialog initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={remove !== null}
        onClose={() => setRemove(null)}
        danger
        title={`Remove ${remove?.name}?`}
        confirmLabel="Remove remote"
        onConfirm={async () => {
          if (remove) await run("Remove remote", () => api.remoteRemove(id, remove.name), { success: `Removed ${remove.name}`, rethrow: true });
        }}
      >
        <p>This only removes the connection from this repository, along with its remote-tracking branches. Nothing on the server is deleted.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={force}
        onClose={() => setForce(false)}
        danger
        title={`Force push ${b?.head ?? ""} to ${b?.upstream ?? ""}?`}
        confirmLabel="Force push"
        acknowledge="I understand remote commits I don't have will be overwritten"
        onConfirm={async () => {
          await run("Force push", () => api.push(id, { forceWithLease: true }), { success: "Force pushed", rethrow: true });
        }}
      >
        <p>Only do this if you rewrote history on purpose (for example after a rebase) and nobody else depends on the remote branch.</p>
      </ConfirmDialog>
    </div>
  );
}
