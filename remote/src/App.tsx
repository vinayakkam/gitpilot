import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Branch,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Close,
  Computer,
  Download,
  Minus,
  Plus,
  Refresh,
  Sync,
  Trash,
  Upload,
} from "./icons";
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
const PRESENCE_EVERY_MS = 8_000;
const REFRESH_EVERY_MS = 20_000;
/** The last thing each computer told us, so opening the app shows something at once. */
const CACHE = "gitpilot.remote.overview.";

type Online = "unknown" | "yes" | "no";

/** Commands worth confirming afterwards. Looking at something isn't news; changing it is. */
const CHANGES_SOMETHING = new Set(["stage", "unstage", "commit", "fetch", "pull", "push"]);

function statusOf(file: RemoteFile): { letter: string; kind: string; label: string } {
  if (file.conflict) return { letter: "!", kind: "conflict", label: file.conflict };
  switch (file.change) {
    case "added":
      return { letter: "A", kind: "added", label: "Added" };
    case "deleted":
      return { letter: "D", kind: "deleted", label: "Deleted" };
    case "renamed":
      return { letter: "R", kind: "renamed", label: "Renamed" };
    case "untracked":
      return { letter: "U", kind: "added", label: "New" };
    default:
      return { letter: "M", kind: "modified", label: "Modified" };
  }
}

/** A path as a filename plus the folder above it, which is what you actually read on a phone. */
function splitPath(path: string): { name: string; folder: string } {
  const parts = path.split("/");
  return { name: parts.pop() ?? path, folder: parts.join("/") };
}

function readCache(device: string | null): RemoteOverview | null {
  if (!device) return null;
  try {
    const raw = localStorage.getItem(CACHE + device);
    return raw ? (JSON.parse(raw) as RemoteOverview) : null;
  } catch {
    return null;
  }
}

function writeCache(device: string, overview: RemoteOverview) {
  try {
    localStorage.setItem(CACHE + device, JSON.stringify(overview));
  } catch {
    // Only a convenience; the list still arrives from the computer.
  }
}

function Dot({ online }: { online: Online }) {
  const label = online === "yes" ? "GitPilot is running" : online === "no" ? "GitPilot isn't running" : "Checking…";
  return <span className={`dot dot-${online}`} role="img" aria-label={label} title={label} />;
}

/** Ahead/behind, as two small counters rather than a sentence. */
function SyncChips({ ahead, behind }: { ahead: number | null; behind: number | null }) {
  if (!ahead && !behind) return null;
  return (
    <span className="chips">
      {!!behind && (
        <span className="chip" title={`${behind} to pull`}>
          <Download size={13} />
          {behind}
        </span>
      )}
      {!!ahead && (
        <span className="chip" title={`${ahead} to push`}>
          <Upload size={13} />
          {ahead}
        </span>
      )}
    </span>
  );
}

function Toast({ busy, error, note }: { busy: boolean; error: string | null; note: string | null }) {
  if (!busy && !error && !note) return null;
  return (
    <div className={`toast ${error ? "toast-error" : note ? "toast-ok" : ""}`} role="status" aria-live="polite">
      {busy ? <span className="spin" aria-hidden /> : error ? <Close size={15} /> : <Check size={15} />}
      <span className="toast-text">{busy ? "Working…" : (error ?? note)}</span>
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
      <span className="install-text">Add to your home screen and it opens like an app.</span>
      <button className="primary small" onClick={() => void install().then(() => setHidden(true))}>
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
        <Close size={16} />
      </button>
    </div>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="cards" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="card repo-card" key={i}>
          <span className="bone" style={{ width: `${50 - i * 7}%` }} />
          <span className="bone bone-sub" style={{ width: `${30 + i * 6}%` }} />
        </div>
      ))}
    </div>
  );
}

function NotPaired() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>GitPilot</h1>
      </header>
      <main className="screen">
        <div className="hero">
          <Computer size={40} />
          <h2 className="hero-title">Not connected yet</h2>
          <p className="muted">This app controls GitPilot on your computer.</p>
        </div>
        <ol className="steps card">
          <li>Open GitPilot on your computer.</li>
          <li>
            Go to <strong>Settings → Remote control</strong> and turn it on.
          </li>
          <li>
            Choose <strong>Pair a phone</strong>.
          </li>
          <li>Point this phone's camera at the code.</li>
        </ol>
        <p className="muted small centre">
          No account, no password. The code carries a key that stays on your phone and your computer.
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
          <ChevronLeft size={20} />
        </button>
        <div className="titles">
          <h1>Computers</h1>
          <p className="subtitle">{pairings.length === 1 ? "1 paired" : `${pairings.length} paired`}</p>
        </div>
      </header>
      <main className="screen">
        <div className="cards">
          {pairings.map((p) => (
            <div className={`card computer-card ${p.device === active ? "is-active" : ""}`} key={p.device}>
              <button className="computer-pick" onClick={() => onPick(p.device)}>
                <span className="computer-icon">
                  <Computer size={20} />
                </span>
                <span className="grow">
                  <span className="card-title">{p.computer ?? "Computer"}</span>
                  <span className="card-sub">
                    {p.device === active ? (
                      <>
                        <Dot online={online} /> Showing this one
                      </>
                    ) : (
                      "Tap to switch"
                    )}
                  </span>
                </span>
                {p.device === active && <Check size={18} className="tick" />}
              </button>
              <button className="ghost icon" onClick={() => setConfirming(p.device)} aria-label={`Forget ${p.computer ?? "computer"}`}>
                <Trash size={17} />
              </button>
              {confirming === p.device && (
                <div className="confirm">
                  <p className="small">Forget this computer? You'd have to scan its code again.</p>
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
            </div>
          ))}
        </div>
        <p className="muted small">
          To add another, open GitPilot there and scan its code. It joins this list rather than replacing anything.
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
        <button className="computer-button" onClick={onComputers} aria-label="Choose a computer">
          <Dot online={online} />
          <span className="computer-name">{overview?.computer ?? name}</span>
          {several && <ChevronDown size={16} />}
        </button>
        <button className="ghost icon" onClick={onRefresh} disabled={busy} aria-label="Refresh">
          <Refresh size={18} className={busy ? "spinning" : undefined} />
        </button>
      </header>
      <main className="screen">
        <InstallOffer />
        {online === "no" && (
          <div className="notice">GitPilot isn't running on that computer. Open it and this catches up by itself.</div>
        )}
        {!loaded && repos.length === 0 ? (
          <Skeleton />
        ) : repos.length === 0 ? (
          <div className="hero">
            <Branch size={34} />
            <h2 className="hero-title">No repositories</h2>
            <p className="muted">Open one in GitPilot and it shows up here.</p>
          </div>
        ) : (
          <div className="cards">
            {repos.map((r) => (
              <button className="card repo-card tappable" key={r.id} onClick={() => onOpen(r)}>
                <span className="repo-head">
                  <span className="card-title">{r.name}</span>
                  {r.changed > 0 && <span className="badge">{r.changed}</span>}
                  <ChevronRight size={18} className="faint" />
                </span>
                <span className="repo-meta">
                  <span className="branch">
                    <Branch size={14} />
                    {r.branch ?? "no branch"}
                  </span>
                  <SyncChips ahead={r.ahead} behind={r.behind} />
                  {r.conflicts > 0 && <span className="chip chip-conflict">{r.conflicts} conflicted</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function FileRow({ file, busy, onToggle }: { file: RemoteFile; busy: boolean; onToggle: () => void }) {
  const s = statusOf(file);
  const { name, folder } = splitPath(file.path);
  const staged = file.area === "staged";
  return (
    <button className="file" onClick={onToggle} disabled={busy}>
      <span className={`status status-${s.kind}`} title={s.label}>
        {s.letter}
      </span>
      <span className="grow">
        <span className="file-name">{name}</span>
        {folder && <span className="file-folder">{folder}</span>}
      </span>
      <span className={`stage-toggle ${staged ? "is-staged" : ""}`} aria-label={staged ? "Unstage" : "Stage"}>
        {staged ? <Minus size={16} /> : <Plus size={16} />}
      </span>
    </button>
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
  const unstaged = detail.files.filter((f) => f.area !== "staged");

  return (
    <>
      <header className="topbar">
        <button className="ghost icon" onClick={onBack} aria-label="Back to repositories">
          <ChevronLeft size={20} />
        </button>
        <div className="titles">
          <h1>{detail.name}</h1>
          <p className="subtitle">
            <Dot online={online} />
            <Branch size={13} />
            {detail.branch ?? "no branch"}
            <SyncChips ahead={detail.ahead} behind={detail.behind} />
          </p>
        </div>
      </header>

      <main className="screen">
        <div className="actions">
          <button disabled={busy} onClick={() => onCommand({ cmd: "fetch", repo: detail.id })}>
            <Sync size={16} /> Fetch
          </button>
          <button disabled={busy} onClick={() => onCommand({ cmd: "pull", repo: detail.id })}>
            <Download size={16} /> Pull
          </button>
          <button disabled={busy} onClick={() => setConfirmPush(true)}>
            <Upload size={16} /> Push
          </button>
        </div>

        {confirmPush && (
          <div className="card confirm">
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
        )}

        {detail.files.length === 0 && (
          <div className="hero">
            <Check size={34} />
            <h2 className="hero-title">Nothing has changed</h2>
            <p className="muted">Every file matches the last commit.</p>
          </div>
        )}

        {staged.length > 0 && (
          <section>
            <h2>
              Staged <span className="count">{staged.length}</span>
              <button
                className="link"
                disabled={busy}
                onClick={() => onCommand({ cmd: "unstage", repo: detail.id, paths: staged.map((f) => f.path) })}
              >
                Unstage all
              </button>
            </h2>
            <div className="card">
              {staged.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  busy={busy}
                  onToggle={() => onCommand({ cmd: "unstage", repo: detail.id, paths: [f.path] })}
                />
              ))}
            </div>
          </section>
        )}

        {unstaged.length > 0 && (
          <section>
            <h2>
              Not staged <span className="count">{unstaged.length}</span>
              <button
                className="link"
                disabled={busy}
                onClick={() => onCommand({ cmd: "stage", repo: detail.id, paths: unstaged.map((f) => f.path) })}
              >
                Stage all
              </button>
            </h2>
            <div className="card">
              {unstaged.map((f) => (
                <FileRow
                  key={`${f.area}:${f.path}`}
                  file={f}
                  busy={busy}
                  onToggle={() => onCommand({ cmd: "stage", repo: detail.id, paths: [f.path] })}
                />
              ))}
            </div>
          </section>
        )}

        {detail.commits.length > 0 && (
          <section>
            <h2>Recent commits</h2>
            <div className="card">
              {detail.commits.map((c) => (
                <div className="commit" key={c.hash}>
                  <span className="commit-subject">{c.subject || "(no message)"}</span>
                  <span className="commit-meta">
                    <span className="mono">{c.shortHash}</span> · {c.author}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Stays within reach while you scroll the files you just staged. */}
      {staged.length > 0 && (
        <div className="commit-bar">
          <textarea
            value={message}
            rows={2}
            placeholder={`Commit ${staged.length === 1 ? "1 file" : `${staged.length} files`}…`}
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
            <Check size={17} /> Commit
          </button>
        </div>
      )}
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
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void loadPairings().then((list) => {
      setPairings(list);
      const chosen = activeDevice();
      setActiveDevice(list.find((p) => p.device === chosen)?.device ?? list[0]?.device ?? null);
    });
  }, []);

  const pairing = useMemo(() => pairings?.find((p) => p.device === active) ?? null, [pairings, active]);
  const relayKey = pairing?.key ?? null;
  const relayDevice = pairing?.device ?? null;
  const relay = useMemo(
    () =>
      relayKey && relayDevice
        ? new Relay(RELAY_BASE, { key: relayKey, device: relayDevice, computer: null, addedAt: 0 })
        : null,
    [relayKey, relayDevice],
  );

  const send = useCallback(
    async (command: Command, quiet = false): Promise<Reply | null> => {
      if (!relay) return null;
      if (quiet && working.current) return null;

      const run = async (): Promise<Reply | null> => {
        working.current = true;
        if (!quiet) setBusy(true);
        setError(null);
        if (!quiet) setNote(null);
        try {
          const reply = await relay.run(command);
          if (reply.ok) {
            if (!quiet && CHANGES_SOMETHING.has(command.cmd)) setNote(reply.message);
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
      };

      const next = queue.current.then(run, run);
      queue.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
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
        if (relayDevice) {
          writeCache(relayDevice, data);
          if (data.computer) {
            noteComputerName(relayDevice, data.computer);
            setPairings((list) => {
              const found = list?.find((p) => p.device === relayDevice);
              if (!list || !found || found.computer === data.computer) return list;
              return list.map((p) => (p.device === relayDevice ? { ...p, computer: data.computer } : p));
            });
          }
        }
      }
    },
    [send, relayDevice],
  );

  const openRepo = useCallback(
    async (repo: RemoteRepo, quiet = false) => {
      const reply = await send({ cmd: "open", repo: repo.id }, quiet);
      if (reply?.ok) setDetail(reply.data as RemoteDetail);
    },
    [send],
  );

  const runAndRefresh = useCallback(
    async (command: Command) => {
      const reply = await send(command);
      if (!reply) return;
      const repoId = "repo" in command ? command.repo : detail?.id;
      if (repoId == null) return;
      const fresh = await send({ cmd: "open", repo: repoId }, true);
      if (fresh?.ok) {
        setDetail(fresh.data as RemoteDetail);
        // The refresh is quiet, so say again what the command itself did.
        if (reply.ok && CHANGES_SOMETHING.has(command.cmd)) setNote(reply.message);
      }
    },
    [send, detail],
  );

  // Show what this computer last said straight away, then bring it up to date.
  useEffect(() => {
    if (!relay) return;
    const cached = readCache(relayDevice);
    setOverview(cached);
    setLoaded(!!cached);
    setDetail(null);
    setOnline("unknown");
    void refreshList(!!cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the computer changes
  }, [relay]);

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
      <Toast busy={busy} error={error} note={note} />
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
            if (device === relayDevice) void send({ cmd: "unpair" }, true);
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
