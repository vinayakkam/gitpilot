import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dismissInstall, install, installDismissed, isInstalled, onInstallAvailable } from "./install";
import { activeDevice, forget, loadPairings, noteComputerName, setActive, type Pairing } from "./link";
import {
  ONLINE_WITHIN_SECONDS,
  Relay,
  type Command,
  type RemoteDetail,
  type RemoteFile,
  type RemoteOverview,
  type RemoteRepo,
  type Reply,
} from "./session";

const RELAY_BASE = "https://api.olittechnologies.co.in";
/** How often to ask the relay whether the computer is still there. */
const PRESENCE_EVERY_MS = 8_000;
/** How often to refresh what's on screen while nothing else is happening. */
const REFRESH_EVERY_MS = 20_000;

type Online = "unknown" | "yes" | "no";

/** The letter for a file's state, as on the desktop: a letter *and* a colour, never colour alone. */
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

function Dot({ online }: { online: Online }) {
  const label = online === "yes" ? "GitPilot is running" : online === "no" ? "GitPilot isn't running" : "Checking…";
  return <span className={`dot dot-${online}`} role="img" aria-label={label} title={label} />;
}

function Banner({ busy, error, note }: { busy: boolean; error: string | null; note: string | null }) {
  if (!busy && !error && !note) return null;
  return (
    <div className={`banner ${error ? "banner-error" : note ? "banner-success" : ""}`} role="status" aria-live="polite">
      {busy && <span className="spin" aria-hidden />}
      <span>{busy ? "Working…" : (error ?? note)}</span>
    </div>
  );
}

function InstallOffer() {
  const [available, setAvailable] = useState(false);
  const [hidden, setHidden] = useState(() => isInstalled() || installDismissed());

  useEffect(() => onInstallAvailable(setAvailable), []);

  if (hidden || !available) return null;
  return (
    <div className="install">
      <span className="install-text">Install this as an app, so it opens from your home screen.</span>
      <button className="primary" onClick={() => void install().then(() => setHidden(true))}>
        Install
      </button>
      <button
        className="ghost icon"
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

/** Shown while nothing has arrived yet, so the screen has shape instead of a blank wait. */
function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card" aria-hidden>
      <ul className="list">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className="row static">
              <span className="row-main">
                <span className="bone" style={{ width: `${55 - i * 8}%` }} />
                <span className="bone bone-sub" style={{ width: `${35 + i * 5}%` }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
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
        <p className="muted">This app controls GitPilot on your computer. It isn't connected to one yet.</p>
        <div className="card">
          <ol className="steps">
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
          your computer. You can pair as many computers as you like — they all live in this one app.
        </p>
      </main>
    </div>
  );
}

function Computers({
  pairings,
  active,
  online,
  onPick,
  onForget,
  onClose,
}: {
  pairings: Pairing[];
  active: string | null;
  online: Online;
  onPick: (device: string) => void;
  onForget: (device: string) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <>
      <header className="topbar">
        <button className="ghost icon" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <div className="titles">
          <h1>Computers</h1>
          <p className="subtitle">{pairings.length === 1 ? "1 paired" : `${pairings.length} paired`}</p>
        </div>
      </header>
      <main className="screen">
        <div className="card">
          <ul className="list">
            {pairings.map((p) => (
              <li key={p.device}>
                <div className="row">
                  <button className="row-tap" onClick={() => onPick(p.device)}>
                    {p.device === active ? <Dot online={online} /> : <span className="dot dot-idle" aria-hidden />}
                    <span className="row-main">
                      <span className="row-title">{p.computer ?? "Computer"}</span>
                      <span className="row-sub">{p.device === active ? "Showing this one" : "Tap to switch"}</span>
                    </span>
                  </button>
                  <button className="ghost small" onClick={() => setConfirming(p.device)}>
                    Forget
                  </button>
                </div>
                {confirming === p.device && (
                  <div className="confirm-row">
                    <span className="small">Forget this computer? You'd need to scan its code again.</span>
                    <div className="actions">
                      <button
                        className="danger"
                        onClick={() => {
                          setConfirming(null);
                          onForget(p.device);
                        }}
                      >
                        Forget
                      </button>
                      <button onClick={() => setConfirming(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="muted small">
          To add another computer, open GitPilot there and scan its code with this phone's camera. It joins this list
          instead of replacing anything.
        </p>
      </main>
    </>
  );
}

function RepoList({
  overview,
  name,
  online,
  loaded,
  busy,
  onOpen,
  onRefresh,
  onComputers,
  several,
}: {
  overview: RemoteOverview | null;
  /** What to call the computer before it has told us itself. */
  name: string;
  online: Online;
  loaded: boolean;
  busy: boolean;
  onOpen: (r: RemoteRepo) => void;
  onRefresh: () => void;
  onComputers: () => void;
  several: boolean;
}) {
  const repos = overview?.repos ?? [];
  return (
    <>
      <header className="topbar">
        <button className="computer" onClick={onComputers} aria-label="Choose a computer">
          <Dot online={online} />
          <span className="computer-name">{overview?.computer ?? name}</span>
          {several && (
            <span className="chevron" aria-hidden>
              ⌄
            </span>
          )}
        </button>
        <button className="ghost icon" onClick={onRefresh} disabled={busy} aria-label="Refresh">
          ↻
        </button>
      </header>
      <main className="screen">
        <InstallOffer />
        {online === "no" && (
          <div className="notice">
            GitPilot isn't running on that computer, so nothing can be done yet. Open it and this will catch up on its
            own.
          </div>
        )}
        <h2>Repositories</h2>
        {!loaded ? (
          <Skeleton />
        ) : repos.length === 0 ? (
          <div className="card">
            <p className="empty">No repositories are open in GitPilot.</p>
          </div>
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
  online,
  busy,
  onBack,
  onCommand,
}: {
  detail: RemoteDetail;
  online: Online;
  busy: boolean;
  onBack: () => void;
  onCommand: (c: Command) => void;
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
        <div className="titles">
          <h1>{detail.name}</h1>
          <p className="subtitle">
            <Dot online={online} /> {syncLine(detail)}
          </p>
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
          <h2>
            Changes {detail.files.length > 0 && <span className="count">{detail.files.length}</span>}
          </h2>
          <div className="card">
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
                        disabled={busy}
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
            <div className="card">
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
          <div className="card">
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
  const [pairings, setPairings] = useState<Pairing[] | null>(null);
  const [active, setActiveDevice] = useState<string | null>(null);
  const [overview, setOverview] = useState<RemoteOverview | null>(null);
  const [detail, setDetail] = useState<RemoteDetail | null>(null);
  const [online, setOnline] = useState<Online>("unknown");
  const [showComputers, setShowComputers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    void loadPairings().then((list) => {
      setPairings(list);
      const chosen = activeDevice();
      setActiveDevice(list.find((p) => p.device === chosen)?.device ?? list[0]?.device ?? null);
    });
  }, []);

  const pairing = useMemo(() => pairings?.find((p) => p.device === active) ?? null, [pairings, active]);
  const relay = useMemo(() => (pairing ? new Relay(RELAY_BASE, pairing) : null), [pairing]);

  const send = useCallback(
    async (command: Command, quiet = false): Promise<Reply | null> => {
      if (!relay || working.current) return null;
      working.current = true;
      if (!quiet) setBusy(true);
      setError(null);
      setNote(null);
      try {
        const reply = await relay.run(command);
        if (reply.ok) {
          if (!quiet) setNote(reply.message);
          setOnline("yes");
        } else setError(reply.message);
        return reply;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [relay],
  );

  const refreshList = useCallback(
    async (quiet = false) => {
      const reply = await send({ cmd: "list" }, quiet);
      if (reply?.ok) {
        const data = reply.data as RemoteOverview;
        setOverview(data);
        setLoaded(true);
        if (pairing && data.computer) {
          noteComputerName(pairing.device, data.computer);
          setPairings((list) =>
            list?.map((p) => (p.device === pairing.device ? { ...p, computer: data.computer } : p)) ?? list,
          );
        }
      }
    },
    [send, pairing],
  );

  const openRepo = useCallback(
    async (repo: RemoteRepo, quiet = false) => {
      const reply = await send({ cmd: "open", repo: repo.id }, quiet);
      if (reply?.ok) setDetail(reply.data as RemoteDetail);
    },
    [send],
  );

  // Anything that changes a repository is followed by a fresh look at it, so the screen never
  // shows a state the command has already moved past.
  const runAndRefresh = useCallback(
    async (command: Command) => {
      const reply = await send(command);
      if (!reply) return;
      const repoId = "repo" in command ? command.repo : detail?.id;
      if (repoId == null) return;
      const fresh = await send({ cmd: "open", repo: repoId }, true);
      if (fresh?.ok) {
        setDetail(fresh.data as RemoteDetail);
        if (reply.ok) setNote(reply.message);
      }
    },
    [send, detail],
  );

  // Switching computers starts again from that computer's own list.
  useEffect(() => {
    if (!relay) return;
    setOverview(null);
    setDetail(null);
    setLoaded(false);
    setOnline("unknown");
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the computer changes
  }, [relay]);

  // The green dot: ask the relay how long ago the computer looked for commands.
  useEffect(() => {
    if (!relay) return;
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      const seen = await relay.presence();
      if (!stopped) setOnline(seen !== null && seen <= ONLINE_WITHIN_SECONDS ? "yes" : "no");
    };
    void check();
    const timer = setInterval(() => void check(), PRESENCE_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [relay]);

  // Keep what's on screen current without anyone pressing anything -- quietly, so the "Working…"
  // bar doesn't flash every twenty seconds.
  useEffect(() => {
    if (!relay || online !== "yes" || showComputers) return;
    const tick = () => {
      if (document.hidden || working.current) return;
      if (detail) void openRepo(detail, true);
      else void refreshList(true);
    };
    const timer = setInterval(tick, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [relay, online, showComputers, detail, openRepo, refreshList]);

  if (pairings === null) return <div className="app" />;
  if (pairings.length === 0) return <NotPaired />;

  return (
    <div className="app">
      <Banner busy={busy} error={error} note={note} />
      {showComputers ? (
        <Computers
          pairings={pairings}
          active={active}
          online={online}
          onPick={(device) => {
            setActive(device);
            setActiveDevice(device);
            setShowComputers(false);
          }}
          onForget={(device) => {
            const left = forget(device);
            setPairings(left);
            if (device === active) setActiveDevice(left[0]?.device ?? null);
            if (left.length === 0) window.location.reload();
          }}
          onClose={() => setShowComputers(false)}
        />
      ) : detail ? (
        <RepoScreen
          detail={detail}
          online={online}
          busy={busy}
          onBack={() => {
            setDetail(null);
            void refreshList(true);
          }}
          onCommand={(c) => void runAndRefresh(c)}
        />
      ) : (
        <RepoList
          overview={overview}
          name={pairing?.computer ?? "Computer"}
          online={online}
          loaded={loaded}
          busy={busy}
          several={pairings.length > 1}
          onOpen={(r) => void openRepo(r)}
          onRefresh={() => void refreshList()}
          onComputers={() => setShowComputers(true)}
        />
      )}
    </div>
  );
}
