import { useCallback, useEffect, useMemo, useState } from "react";
import { importKey } from "./crypto";
import { forgetLink, loadLink, type Link } from "./link";
import { Relay, type Command, type RemoteDetail, type RemoteFile, type RemoteRepo, type Reply } from "./session";

const RELAY_BASE = "https://api.olittechnologies.co.in";

/** Shown until a phone has been paired: there is nothing to do here without a QR code. */
function NotPaired() {
  return (
    <main className="screen centred">
      <h1>GitPilot remote</h1>
      <p className="muted">
        This page controls GitPilot on your computer. To connect, open GitPilot there, go to
        <strong> Settings → Remote control</strong>, choose <strong>Pair a phone</strong>, and point this phone's camera at
        the code it shows.
      </p>
      <p className="muted small">
        Nothing is stored here until you do, and there is no account to create. The code holds a key that stays on your
        phone and your computer.
      </p>
    </main>
  );
}

function Status({ busy, error, note }: { busy: boolean; error: string | null; note: string | null }) {
  if (!busy && !error && !note) return null;
  return (
    <div className={`status ${error ? "status-error" : ""}`} role="status" aria-live="polite">
      {busy ? "Working…" : error ?? note}
    </div>
  );
}

function RepoList({ repos, onOpen, onRefresh }: { repos: RemoteRepo[]; onOpen: (r: RemoteRepo) => void; onRefresh: () => void }) {
  return (
    <main className="screen">
      <header className="bar">
        <h1>Repositories</h1>
        <button className="ghost" onClick={onRefresh} aria-label="Refresh">
          ↻
        </button>
      </header>
      {repos.length === 0 && <p className="muted">No repositories are open in GitPilot.</p>}
      <ul className="list">
        {repos.map((r) => (
          <li key={r.id}>
            <button className="row" onClick={() => onOpen(r)}>
              <span className="row-main">
                <span className="row-title">{r.name}</span>
                <span className="row-sub">
                  {r.branch ?? "no branch"}
                  {r.behind ? ` · ${r.behind} to pull` : ""}
                  {r.ahead ? ` · ${r.ahead} to push` : ""}
                </span>
              </span>
              {r.changed > 0 && <span className="pill">{r.changed}</span>}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

function FileRow({ file, onToggle }: { file: RemoteFile; onToggle: (f: RemoteFile) => void }) {
  const staged = file.area === "staged";
  return (
    <li>
      <button className="row" onClick={() => onToggle(file)}>
        <span className={`glyph glyph-${file.change}`} aria-hidden>
          {file.change.charAt(0).toUpperCase()}
        </span>
        <span className="row-main">
          <span className="row-title mono">{file.path}</span>
          <span className="row-sub">{file.conflict ?? (staged ? "Staged" : "Not staged")}</span>
        </span>
        <span className="ghost small">{staged ? "Unstage" : "Stage"}</span>
      </button>
    </li>
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
    <main className="screen">
      <header className="bar">
        <button className="ghost" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1>{detail.name}</h1>
      </header>
      <p className="muted small">
        {detail.branch ?? "no branch"}
        {detail.behind ? ` · ${detail.behind} to pull` : ""}
        {detail.ahead ? ` · ${detail.ahead} to push` : ""}
      </p>

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
        <div className="confirm">
          <p>Push {detail.ahead ?? ""} to the remote?</p>
          <div className="actions">
            <button
              className="primary"
              onClick={() => {
                setConfirmPush(false);
                onCommand({ cmd: "push", repo: detail.id, confirmed: true });
              }}
            >
              Yes, push
            </button>
            <button className="ghost" onClick={() => setConfirmPush(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2>Changes</h2>
      {detail.files.length === 0 && <p className="muted">Nothing has changed.</p>}
      <ul className="list">
        {detail.files.map((f) => (
          <FileRow
            key={`${f.area}:${f.path}`}
            file={f}
            onToggle={(file) =>
              onCommand(
                file.area === "staged"
                  ? { cmd: "unstage", repo: detail.id, paths: [file.path] }
                  : { cmd: "stage", repo: detail.id, paths: [file.path] },
              )
            }
          />
        ))}
      </ul>

      {staged.length > 0 && (
        <section className="commit">
          <h2>Commit {staged.length === 1 ? "1 file" : `${staged.length} files`}</h2>
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
        </section>
      )}

      <h2>Recent commits</h2>
      <ul className="list">
        {detail.commits.map((c) => (
          <li key={c.hash}>
            <div className="row static">
              <span className="row-main">
                <span className="row-title">{c.subject || "(no message)"}</span>
                <span className="row-sub mono">
                  {c.shortHash} · {c.author}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
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
        if (!reply.ok) setError(reply.message);
        else setNote(reply.message);
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
    if (reply?.ok) setRepos(reply.data as RemoteRepo[]);
  }, [send]);

  const openRepo = useCallback(
    async (repo: RemoteRepo) => {
      const reply = await send({ cmd: "open", repo: repo.id });
      if (reply?.ok) setDetail(reply.data as RemoteDetail);
    },
    [send],
  );

  // After anything that changes a repository, show the repository again rather than a stale list.
  const runAndRefresh = useCallback(
    async (command: Command) => {
      const reply = await send(command);
      if (!reply) return;
      const repoId = "repo" in command ? command.repo : detail?.id;
      if (repoId != null) {
        const fresh = await send({ cmd: "open", repo: repoId });
        if (fresh?.ok) setDetail(fresh.data as RemoteDetail);
      }
    },
    [send, detail],
  );

  useEffect(() => {
    if (relay) void refreshList();
  }, [relay, refreshList]);

  if (!link) return <NotPaired />;

  return (
    <>
      <Status busy={busy} error={error} note={note} />
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
        <RepoList repos={repos} onOpen={(r) => void openRepo(r)} onRefresh={() => void refreshList()} />
      )}
      <footer className="foot">
        <button
          className="ghost small"
          onClick={() => {
            forgetLink();
            window.location.reload();
          }}
        >
          Forget this computer
        </button>
      </footer>
    </>
  );
}
