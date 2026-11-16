import { useCallback, useEffect, useMemo, useState } from "react";
import { importKey } from "./crypto";
import { dismissInstall, install, installDismissed, isInstalled, onInstallAvailable } from "./install";
import { forgetLink, loadLink, type Link } from "./link";
import { Relay, type Command, type RemoteDetail, type RemoteFile, type RemoteRepo, type Reply } from "./session";

const RELAY_BASE = "https://api.olittechnologies.co.in";

/** The letter shown for a file's state, as on the desktop: a letter *and* a colour, never colour alone. */
function glyphFor(file: RemoteFile): { letter: string; kind: string; label: string } {
  if (file.conflict) return { letter: "!", kind: "conflict", label: file.conflict };
  switch (file.change) {
    case "added":
      return { letter: "A", kind: "added", label: "Added" };
    case "deleted":
      return { letter: "D", kind: "deleted", label: "Deleted" };
    case "renamed":
      return { letter: "R", kind: "renamed", label: "Renamed" };
    case "untracked":
      return { letter: "U", kind: "added", label: "New file" };
    default:
      return { letter: "M", kind: "modified", label: "Modified" };
  }
}

function syncLine(repo: { branch: string | null; ahead: number | null; behind: number | null }): string {
  const parts = [repo.branch ?? "no branch"];
  if (repo.behind) parts.push(`${repo.behind} to pull`);
  if (repo.ahead) parts.push(`${repo.ahead} to push`);
  return parts.join(" · ");
}

function Banner({ busy, error, note }: { busy: boolean; error: string | null; note: string | null }) {
  if (!busy && !error && !note) return null;
  const tone = error ? "banner-error" : note ? "banner-success" : "";
  return (
    <div className={`banner banner-sticky ${tone}`} role="status" aria-live="polite">
      {busy && <span className="spin" aria-hidden />}
      <span>{busy ? "Working…" : (error ?? note)}</span>
    </div>
  );
}

/** Offers to install the page as an app, once, and only when the browser says it can. */
function InstallOffer() {
  const [available, setAvailable] = useState(false);
  const [hidden, setHidden] = useState(() => isInstalled() || installDismissed());

  useEffect(() => onInstallAvailable(setAvailable), []);

  if (hidden || !available) return null;
  return (
    <div className="install">
      <span className="install-text">Install this as an app, so it opens from your home screen.</span>
      <button
        className="primary"
        onClick={() => {
          void install().then(() => setHidden(true));
        }}
      >
        Install
      </button>
      <button
        className="ghost"
        aria-label="Not now"
        onClick={() => {
          dismissInstall();
          setHidden(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}

function NotPaired() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>GitPilot remote</h1>
      </header>
      <main className="screen centred">
        <p className="muted">This page controls GitPilot on your computer. It isn't connected to one yet.</p>
        <div className="card">
          <ol className="screen" style={{ paddingLeft: 30, gap: 8 }}>
            <li>Open GitPilot on your computer.</li>
            <li>
              Go to <strong>Settings → Remote control</strong> and turn it on.
            </li>
            <li>
              Choose <strong>Pair a phone</strong>.
            </li>
            <li>Point this phone's camera at the code it shows.</li>
          </ol>
        </div>
        <p className="muted small">
          There's no account to create and no password anywhere. The code carries a key that stays on your phone and
          your computer.
        </p>
      </main>
    </div>
  );
}

function RepoList({
  repos,
  onOpen,
  onRefresh,
  busy,
  loaded,
}: {
  repos: RemoteRepo[];
  onOpen: (r: RemoteRepo) => void;
  onRefresh: () => void;
  busy: boolean;
  /** True once the computer has actually answered, so "none" isn't shown while asking. */
  loaded: boolean;
}) {
  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Repositories</h1>
          <p className="subtitle">On your computer</p>
        </div>
        <button className="ghost icon" onClick={onRefresh} disabled={busy} aria-label="Refresh">
          ↻
        </button>
      </header>
      <main className="screen">
        <InstallOffer />
        {repos.length === 0 ? (
          loaded && (
            <div className="card">
              <p className="empty">No repositories are open in GitPilot.</p>
            </div>
          )
        ) : (
          <div className="card">
            <ul className="list">
              {repos.map((r) => (
                <li key={r.id}>
                  <button className="row" onClick={() => onOpen(r)}>
                    <span className="row-main">
                      <span className="row-title">{r.name}</span>
                      <span className="row-sub">{syncLine(r)}</span>
                    </span>
                    {r.conflicts > 0 && <span className="glyph glyph-conflict">!</span>}
                    {r.changed > 0 && <span className="pill">{r.changed}</span>}
                    <span className="chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}

function RepoScreen({
  detail,
  onBack,
  onCommand,
  busy,
}: {
  detail: RemoteDetail;
  onBack: () => void;
  onCommand: (c: Command) => void;
  busy: boolean;
}) {
  const [message, setMessage] = useState("");
  const [confirmPush, setConfirmPush] = useState(false);
  const staged = detail.files.filter((f) => f.area === "staged");

  return (
    <>
      <header className="topbar">
        <button className="ghost icon" onClick={onBack} aria-label="Back to repositories">
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{detail.name}</h1>
          <p className="subtitle">{syncLine(detail)}</p>
        </div>
      </header>

      <main className="screen">
        <div className="actions">
          <button disabled={busy} onClick={() => onCommand({ cmd: "fetch", repo: detail.id })}>
            Fetch
          </button>
          <button disabled={busy} onClick={() => onCommand({ cmd: "pull", repo: detail.id })}>
            Pull
          </button>
          <button disabled={busy} onClick={() => setConfirmPush(true)}>
            Push
          </button>
        </div>

        {confirmPush && (
          <div className="card">
            <div className="field">
              <p>
                Push {detail.ahead ? `${detail.ahead} commit${detail.ahead === 1 ? "" : "s"}` : "this branch"} to the
                remote?
              </p>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() => {
                    setConfirmPush(false);
                    onCommand({ cmd: "push", repo: detail.id, confirmed: true });
                  }}
                >
                  Push
                </button>
                <button onClick={() => setConfirmPush(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <section>
          <h2>Changes</h2>
          <div className="card" style={{ marginTop: 8 }}>
            {detail.files.length === 0 ? (
              <p className="empty">Nothing has changed.</p>
            ) : (
              <ul className="list">
                {detail.files.map((f) => {
                  const g = glyphFor(f);
                  const isStaged = f.area === "staged";
                  return (
                    <li key={`${f.area}:${f.path}`}>
                      <button
                        className="row"
                        onClick={() =>
                          onCommand(
                            isStaged
                              ? { cmd: "unstage", repo: detail.id, paths: [f.path] }
                              : { cmd: "stage", repo: detail.id, paths: [f.path] },
                          )
                        }
                      >
                        <span className={`glyph glyph-${g.kind}`} title={g.label} aria-hidden>
                          {g.letter}
                        </span>
                        <span className="row-main">
                          <span className="row-title mono">{f.path}</span>
                          <span className="row-sub">{f.conflict ?? (isStaged ? "Staged" : g.label)}</span>
                        </span>
                        <span className={`pill ${isStaged ? "" : "pill-accent"}`}>{isStaged ? "Unstage" : "Stage"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {staged.length > 0 && (
          <section>
            <h2>Commit {staged.length === 1 ? "1 file" : `${staged.length} files`}</h2>
            <div className="card" style={{ marginTop: 8 }}>
              <div className="field">
                <textarea
                  value={message}
                  rows={3}
                  placeholder="What changed?"
                  onChange={(e) => setMessage(e.target.value)}
                  aria-label="Commit message"
                />
                <button
                  className="primary"
                  disabled={busy || !message.trim()}
                  onClick={() => {
                    onCommand({ cmd: "commit", repo: detail.id, message: message.trim() });
                    setMessage("");
                  }}
                >
                  Commit
                </button>
              </div>
            </div>
          </section>
        )}

        <section>
          <h2>Recent commits</h2>
          <div className="card" style={{ marginTop: 8 }}>
            <ul className="list">
              {detail.commits.map((c) => (
                <li key={c.hash}>
                  <div className="row static">
                    <span className="row-main">
                      <span className="row-title">{c.subject || "(no message)"}</span>
                      <span className="row-sub">
                        <span className="mono">{c.shortHash}</span> · {c.author}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}

export function App() {
  const [link] = useState<Link | null>(() => loadLink());
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [detail, setDetail] = useState<RemoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [listed, setListed] = useState(false);

  useEffect(() => {
    if (!link) return;
    importKey(link.key).then(setKey, (e: Error) => setError(e.message));
  }, [link]);

  const relay = useMemo(() => (link && key ? new Relay(RELAY_BASE, link, key) : null), [link, key]);

  const send = useCallback(
    async (command: Command): Promise<Reply | null> => {
      if (!relay) return null;
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        const reply = await relay.run(command);
        if (reply.ok) setNote(reply.message);
        else setError(reply.message);
        return reply;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [relay],
  );

  const refreshList = useCallback(async () => {
    const reply = await send({ cmd: "list" });
    if (reply?.ok) {
      setRepos(reply.data as RemoteRepo[]);
      setListed(true);
    }
  }, [send]);

  const openRepo = useCallback(
    async (repo: RemoteRepo) => {
      const reply = await send({ cmd: "open", repo: repo.id });
      if (reply?.ok) setDetail(reply.data as RemoteDetail);
    },
    [send],
  );

  // Anything that changes a repository is followed by a fresh look at it, so the screen is never
  // showing a state that the command has already moved on from.
  const runAndRefresh = useCallback(
    async (command: Command) => {
      const reply = await send(command);
      if (!reply) return;
      const repoId = "repo" in command ? command.repo : detail?.id;
      if (repoId == null) return;
      const fresh = await send({ cmd: "open", repo: repoId });
      if (fresh?.ok) {
        setDetail(fresh.data as RemoteDetail);
        setNote(reply.ok ? reply.message : null);
        if (!reply.ok) setError(reply.message);
      }
    },
    [send, detail],
  );

  useEffect(() => {
    if (relay) void refreshList();
  }, [relay, refreshList]);

  if (!link) return <NotPaired />;

  return (
    <div className="app">
      <Banner busy={busy} error={error} note={note} />
      {detail ? (
        <RepoScreen
          detail={detail}
          busy={busy}
          onBack={() => {
            setDetail(null);
            void refreshList();
          }}
          onCommand={(c) => void runAndRefresh(c)}
        />
      ) : (
        <RepoList
          repos={repos}
          busy={busy}
          loaded={listed}
          onOpen={(r) => void openRepo(r)}
          onRefresh={() => void refreshList()}
        />
      )}
      <footer className="screen">
        <button
          className="ghost"
          onClick={() => {
            forgetLink();
            window.location.reload();
          }}
        >
          Forget this computer
        </button>
      </footer>
    </div>
  );
}
