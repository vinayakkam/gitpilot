import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, KeyRound } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "@/bindings/AppError";
import type { DeviceCode } from "@/bindings/DeviceCode";
import type { GitHubUser } from "@/bindings/GitHubUser";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { openLink } from "@/lib/links";
import { useStore } from "@/store/AppStore";
import { githubAccountChanged } from "./useGitHubAccount";

/** Creating a classic token with the scope GitPilot needs, pre-filled. */
export const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=GitPilot";

type Mode = "browser" | "token";

/** Sign in to GitHub in the browser (device flow) or with a personal access token. */
export function SignInDialog({ open, onClose, deviceFlow }: { open: boolean; onClose: () => void; deviceFlow: boolean }) {
  const { notify } = useStore();
  const [mode, setMode] = useState<Mode>(deviceFlow ? "browser" : "token");
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [starting, setStarting] = useState(false);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const waiting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setMode(deviceFlow ? "browser" : "token");
    setCode(null);
    setToken("");
    setError(null);
  }, [open, deviceFlow]);

  const done = (u: GitHubUser) => {
    githubAccountChanged();
    notify({ tone: "success", title: `Signed in to GitHub as ${u.login}` });
    onClose();
  };

  const stopWaiting = () => {
    if (waiting.current) void api.opCancel("github-login");
  };

  // A sign-in still waiting when this goes away (e.g. the window closes) is cancelled.
  useEffect(
    () => () => {
      if (waiting.current) void api.opCancel("github-login");
    },
    [],
  );

  const close = () => {
    stopWaiting();
    onClose();
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const c = await api.githubDeviceStart();
      setCode(c);
      waiting.current = true;
      api.githubDeviceWait().then(
        (u) => {
          waiting.current = false;
          done(u);
        },
        (e) => {
          waiting.current = false;
          const err = toAppError(e);
          if (err.kind !== "cancelled") {
            setCode(null);
            setError(err);
          }
        },
      );
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setStarting(false);
    }
  };

  const openGitHub = async (c: DeviceCode) => {
    try {
      await writeText(c.userCode);
    } catch {
      /* the code is on screen to type */
    }
    void openLink(c.verificationUri);
  };

  const submitToken = async () => {
    if (!token.trim()) return;
    setError(null);
    setChecking(true);
    try {
      done(await api.githubTokenSet(token));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={checking}
      width={480}
      title="Sign in to GitHub"
      description="GitPilot uses your GitHub account to list your repositories and work with pull requests. Cloning, pulling and pushing keep using your usual Git credentials."
      onSubmit={mode === "token" ? submitToken : undefined}
      footer={
        <>
          <Button onClick={close} disabled={checking}>
            Cancel
          </Button>
          {mode === "token" && (
            <Button type="submit" variant="primary" loading={checking} disabled={!token.trim()}>
              Sign in
            </Button>
          )}
          {mode === "browser" && !code && (
            <Button variant="primary" loading={starting} onClick={() => void start()} autoFocus>
              Continue in browser
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {deviceFlow && (
          <Segmented
            label="Sign-in method"
            value={mode}
            onChange={(m) => {
              stopWaiting();
              setCode(null);
              setError(null);
              setMode(m);
            }}
            options={[
              { value: "browser", label: "In the browser" },
              { value: "token", label: "With a token" },
            ]}
          />
        )}
        {mode === "browser" &&
          (code ? (
            <div className="flex flex-col items-center gap-3 rounded border border-border bg-surface-2 p-4 text-center">
              <p className="text-base text-muted">Enter this code on GitHub:</p>
              <p className="selectable font-mono text-2xl font-semibold tracking-widest" aria-label="Sign-in code">
                {code.userCode}
              </p>
              <div className="flex gap-2">
                <Button variant="primary" icon={<ExternalLink size={13} />} onClick={() => void openGitHub(code)} autoFocus>
                  Copy code and open GitHub
                </Button>
                <Button icon={<Copy size={13} />} onClick={() => void writeText(code.userCode).then(() => notify({ tone: "success", title: "Code copied" }))}>
                  Copy
                </Button>
              </div>
              <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
                <Spinner size={11} /> Waiting for you to approve GitPilot on GitHub…
              </p>
            </div>
          ) : (
            <p className="text-base text-muted">GitPilot shows a code, you enter it at github.com/login/device and approve access to your repositories. No password is typed into GitPilot.</p>
          ))}
        {mode === "token" && (
          <>
            <Field
              label="Personal access token"
              hint={
                <>
                  A classic token with the <code className="font-mono">repo</code> scope, or a fine-grained token with read and write access to Contents and Pull requests.{" "}
                  <button type="button" className="text-accent-text hover:underline" onClick={() => void openLink(NEW_TOKEN_URL)}>
                    Create a token on GitHub
                  </button>
                </>
              }
            >
              {(p) => (
                <Input {...p} type="password" autoFocus autoComplete="off" placeholder="ghp_… or github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-sm" />
              )}
            </Field>
            <p className="flex items-start gap-1.5 text-sm text-muted">
              <KeyRound size={13} className="mt-0.5 shrink-0" /> The token is checked with GitHub, then kept in your system keychain. It's never written to GitPilot's settings file.
            </p>
          </>
        )}
        {error && <ErrorNotice error={error} />}
      </div>
    </Dialog>
  );
}
