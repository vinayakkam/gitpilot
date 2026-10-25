import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { FolderGit2 } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { RepoRecord } from "@/bindings/RepoRecord";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { GitHubRepoPicker } from "@/features/github/GitHubRepoPicker";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { repoNameFromUrl } from "@/lib/format";
import { pickFolder } from "@/lib/repoFlows";
import { useStore } from "@/store/AppStore";

interface RepoActions {
  addExisting: () => Promise<void>;
  createNew: () => Promise<void>;
  startClone: () => void;
  relocate: (repo: RepoRecord) => Promise<void>;
}

const Ctx = createContext<RepoActions | null>(null);

export function useRepoActions(): RepoActions {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRepoActions outside provider");
  return c;
}

type InitState = { path: string; reason: "notRepo" | "new" } | null;

export function RepoActionsProvider({ children }: { children: ReactNode }) {
  const { openRepo, refreshRepos, notify, settings } = useStore();
  const [init, setInit] = useState<InitState>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initError, setInitError] = useState<AppError | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);

  const report = useCallback((title: string, e: unknown) => notify({ tone: "error", title, error: toAppError(e) }), [notify]);

  const addExisting = useCallback(async () => {
    try {
      const path = await pickFolder("Open a Git repository");
      if (!path) return;
      const info = await api.repoInspectPath(path);
      if (info.registeredId != null) {
        await openRepo(info.registeredId);
        return;
      }
      if (info.repoRoot) {
        const rec = await api.repoAdd(path);
        await refreshRepos();
        await openRepo(rec.id);
        notify({ tone: "success", title: `Added ${rec.name}` });
        return;
      }
      setInitError(null);
      setInit({ path, reason: "notRepo" });
    } catch (e) {
      report("Couldn't open that folder", e);
    }
  }, [openRepo, refreshRepos, notify, report]);

  const createNew = useCallback(async () => {
    try {
      const path = await pickFolder("Choose a folder for the new repository");
      if (!path) return;
      const info = await api.repoInspectPath(path);
      if (info.repoRoot) {
        notify({
          tone: "info",
          title: "That folder is already inside a Git repository",
          body: info.repoRoot,
        });
        return;
      }
      setInitError(null);
      setInit({ path, reason: "new" });
    } catch (e) {
      report("Couldn't use that folder", e);
    }
  }, [notify, report]);

  const doInit = async () => {
    if (!init) return;
    setInitBusy(true);
    setInitError(null);
    try {
      const rec = await api.repoInit(init.path);
      await refreshRepos();
      setInit(null);
      await openRepo(rec.id);
      notify({ tone: "success", title: `Created repository ${rec.name}` });
    } catch (e) {
      setInitError(toAppError(e));
    } finally {
      setInitBusy(false);
    }
  };

  const relocate = useCallback(
    async (repo: RepoRecord) => {
      try {
        const path = await pickFolder(`Locate ${repo.name}`);
        if (!path) return;
        const rec = await api.repoRelocate(repo.id, path);
        await refreshRepos();
        notify({ tone: "success", title: `Updated location of ${rec.name}` });
      } catch (e) {
        report("Couldn't update the location", e);
      }
    },
    [refreshRepos, notify, report],
  );

  const branch = settings?.defaultBranch.trim();

  return (
    <Ctx.Provider value={{ addExisting, createNew, startClone: () => setCloneOpen(true), relocate }}>
      {children}
      <Dialog
        open={init !== null}
        onClose={() => setInit(null)}
        busy={initBusy}
        title={init?.reason === "notRepo" ? "This folder isn't a Git repository" : "Create a new repository"}
        description={
          init?.reason === "notRepo"
            ? "GitPilot can create a new, empty repository here. Your existing files stay as they are and become untracked changes you can commit."
            : "GitPilot will run git init in this folder. Nothing is committed until you choose to."
        }
        onSubmit={doInit}
        footer={
          <>
            <Button onClick={() => setInit(null)} disabled={initBusy}>
              Cancel
            </Button>
            {init?.reason === "notRepo" && (
              <Button
                onClick={() => {
                  setInit(null);
                  void addExisting();
                }}
                disabled={initBusy}
              >
                Choose another folder
              </Button>
            )}
            <Button type="submit" variant="primary" loading={initBusy}>
              Create repository
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2">
          <FolderGit2 size={15} className="shrink-0 text-muted" />
          <span className="selectable truncate font-mono text-sm" title={init?.path}>
            {init?.path}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Initial branch: {branch ? <code className="font-mono">{branch}</code> : "Git's default (set one in Settings → Git)"}
        </p>
        {initError && <ErrorNotice className="mt-3" error={initError} />}
      </Dialog>
      <CloneDialog open={cloneOpen} onClose={() => setCloneOpen(false)} />
    </Ctx.Provider>
  );
}

function CloneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openRepo, refreshRepos, notify, progress } = useStore();
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [source, setSource] = useState<"url" | "github">("url");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const reset = () => {
    setUrl("");
    setName("");
    setNameTouched(false);
    setSource("url");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!url.trim() || !parent || !name.trim()) {
      setError({ kind: "invalidInput", message: "Enter a URL, choose a location and a folder name.", detail: null });
      return;
    }
    setBusy(true);
    try {
      const rec = await api.repoClone(url.trim(), parent, name.trim());
      await refreshRepos();
      reset();
      onClose();
      await openRepo(rec.id);
      notify({ tone: "success", title: `Cloned ${rec.name}` });
    } catch (e) {
      const err = toAppError(e);
      if (err.kind === "cancelled") notify({ tone: "info", title: "Clone stopped", body: "The partly downloaded folder was removed." });
      else setError(err);
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  };

  const cancelClone = () => {
    setCancelling(true);
    void api.opCancel("clone");
  };

  const isSsh = /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(url.trim());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      width={500}
      title="Clone a repository"
      description="Copy a repository from GitHub, GitLab, Bitbucket or any Git server to this computer."
      onSubmit={source === "url" ? submit : undefined}
      footer={
        <>
          {busy ? (
            <Button onClick={cancelClone} disabled={cancelling}>
              {cancelling ? "Stopping…" : "Stop cloning"}
            </Button>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={source === "github"}>
            {busy ? "Cloning…" : "Clone"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label="Clone from"
          value={source}
          onChange={setSource}
          options={[
            { value: "url", label: "Repository URL" },
            { value: "github", label: "Your GitHub repositories" },
          ]}
        />
        {source === "github" && !busy ? (
          <GitHubRepoPicker
            onPick={(repo, picked) => {
              setUrl(picked);
              if (!nameTouched) setName(repo.name);
              setSource("url");
            }}
          />
        ) : (
          <>
            <Field
              label="Repository URL"
              hint={
                isSsh
                  ? "SSH URLs use your SSH keys and agent. If authentication fails, check your SSH setup for this host."
                  : "HTTPS or SSH, e.g. https://github.com/owner/repo.git or git@gitlab.com:owner/repo.git"
              }
            >
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  placeholder="https://…"
                  value={url}
                  disabled={busy}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (!nameTouched) setName(repoNameFromUrl(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label="Location" hint="The repository is cloned into a new folder inside this one.">
              {(p) => (
                <div className="flex gap-2">
                  <Input {...p} readOnly value={parent} placeholder="Choose a folder" className="font-mono text-sm" />
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      const f = await pickFolder("Choose where to clone", parent || undefined);
                      if (f) setParent(f);
                    }}
                  >
                    Choose…
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Folder name">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  disabled={busy}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                />
              )}
            </Field>
          </>
        )}
        {busy && (
          <p className="selectable truncate font-mono text-sm text-muted" aria-live="polite">
            {progress ?? "Connecting…"}
          </p>
        )}
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
