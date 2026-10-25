import { useEffect, useState } from "react";
import { CircleCheck, CircleDashed } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { SigningScope } from "@/bindings/SigningScope";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

const FORMAT_LABEL = { ssh: "SSH", gpg: "GPG", x509: "X.509" } as const;

/** Turn commit signing on or off, for every repository or just the open one. */
export function SigningSettings() {
  const { activeRepo, notify } = useStore();
  const [scope, setScope] = useState<SigningScope>("global");
  const repoId = scope === "repository" ? (activeRepo?.id ?? null) : null;
  const cfg = useAsync(() => api.signingGet(repoId), [repoId]);
  const keys = useAsync(() => api.signingKeys(), []);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  // Preselect the key in use, or the first usable one.
  useEffect(() => {
    const list = keys.data ?? [];
    const inUse = list.find((k) => k.value === cfg.data?.key);
    setChoice((c) => c || (inUse ?? list.find((k) => !k.expired))?.value || "");
  }, [keys.data, cfg.data?.key]);

  useEffect(() => {
    if (scope === "repository" && !activeRepo) setScope("global");
  }, [scope, activeRepo]);

  const c = cfg.data;
  const chosen = keys.data?.find((k) => k.value === choice);
  const where = scope === "global" ? "all repositories" : activeRepo?.name;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await cfg.reload();
      notify({ tone: "success", title: done });
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {activeRepo && (
        <Segmented
          label="Signing applies to"
          value={scope}
          onChange={setScope}
          options={[
            { value: "global", label: "All repositories" },
            { value: "repository", label: `Only ${activeRepo.name}` },
          ]}
        />
      )}
      {cfg.loading && !c ? (
        <Spinner label="Reading the signing setup" />
      ) : c?.enabled ? (
        <p className="flex items-start gap-2 text-base">
          <CircleCheck size={15} className="mt-0.5 shrink-0 text-success" />
          <span>
            Commits are signed with the {FORMAT_LABEL[c.format]} key <span className="selectable break-all font-mono text-sm">{c.key ?? "(default key)"}</span>
            {c.scope && <span className="text-muted"> ({c.scope === "global" ? "set for all repositories" : "set for this repository"})</span>}.
          </span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-base text-muted">
          <CircleDashed size={15} className="shrink-0 text-faint" /> Commits aren't signed{scope === "repository" ? " in this repository" : ""}.
        </p>
      )}
      {cfg.error && <ErrorNotice compact error={cfg.error} />}
      {keys.loading && !keys.data ? (
        <Spinner label="Looking for keys" />
      ) : keys.data && keys.data.length > 0 ? (
        <Field label="Signing key" hint="SSH keys from your .ssh folder and GPG keys from your keyring.">
          {(p) => (
            <Select {...p} value={choice} onChange={(e) => setChoice(e.target.value)}>
              {keys.data!.map((k) => (
                <option key={`${k.format}:${k.value}`} value={k.value} disabled={k.expired}>
                  {FORMAT_LABEL[k.format]}: {k.label}
                  {k.expired ? " (expired)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted">
          No SSH or GPG keys were found. Create one with <code className="font-mono">ssh-keygen -t ed25519</code>, then come back.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!chosen || (c?.enabled && c.key === chosen.value && c.scope === scope)}
          onClick={() => chosen && void act(() => api.signingEnable(repoId, scope, chosen.format, chosen.value), `Commit signing is on for ${where}`)}
        >
          {c?.enabled ? "Use this key" : "Turn on signing"}
        </Button>
        {c?.enabled && c.scope === scope && (
          <Button size="sm" disabled={busy} onClick={() => void act(() => api.signingDisable(repoId, scope), `Commit signing is off for ${where}`)}>
            Turn off
          </Button>
        )}
      </div>
      {error && <ErrorNotice compact error={error} />}
      <p className="text-sm text-muted">
        To get the Verified badge on GitHub too, add the same key to your GitHub account as a signing key.{" "}
        <button type="button" className="text-accent-text hover:underline" onClick={() => void openLink("https://github.com/settings/keys")}>
          Open GitHub key settings
        </button>
      </p>
    </div>
  );
}
