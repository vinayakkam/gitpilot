import { useEffect } from "react";
import { CircleCheck, CircleDashed, LogIn, RefreshCw } from "lucide-react";
import { openLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

const METHOD_LABEL: Record<string, string> = {
  "claude.ai": "Claude subscription",
  oauth_token: "Claude account",
  api_key: "Anthropic API key",
  apiKey: "Anthropic API key",
};

/** Claude Code's install and sign-in state, with a button to sign in with a Claude account. */
export function ClaudeAccount({ compact }: { compact?: boolean }) {
  const { settings, run } = useStore();
  const det = useAsync(() => api.claudeDetect(), [settings?.claudeCode.path, settings?.claudeCode.terminal]);
  const found = det.data?.found === true;
  const auth = useAsync(() => api.claudeAuthStatus(), [found, settings?.claudeCode.path], found);
  const reloadAuth = auth.reload;

  // Signing in happens in a terminal window; re-check when the user comes back to GitPilot.
  useEffect(() => {
    if (!found) return;
    const onFocus = () => void reloadAuth();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [found, reloadAuth]);

  if (det.loading && !det.data) return <Spinner label="Looking for Claude Code" />;

  if (!found) {
    return (
      <div className="flex flex-col gap-2 rounded border border-border bg-surface-2 p-3 text-base">
        <p className="flex items-center gap-2 font-medium">
          <CircleDashed size={15} className="text-faint" /> Claude Code isn't installed
        </p>
        <p className="text-muted">Install Claude Code, then sign in with your Claude account. GitPilot will use it to write commit messages, with no API key needed.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void openLink("https://docs.claude.com/en/docs/claude-code/setup")}>How to install</Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void det.reload()}>Check again</Button>
        </div>
      </div>
    );
  }

  const signIn = () => run("Open Claude sign-in", () => api.claudeLogin(), { refresh: false });
  const a = auth.data;

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-2 p-3 text-base">
      {auth.loading && !a ? (
        <Spinner label="Checking your Claude sign-in" />
      ) : a?.checked && a.loggedIn ? (
        <>
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck size={15} className="text-success" /> Signed in{a.method ? ` with ${METHOD_LABEL[a.method] ?? a.method}` : ""}
          </p>
          {!compact && <p className="text-muted">GitPilot uses this account when you pick “Claude Code” as the AI provider. Usage counts toward your Claude plan's limits.</p>}
        </>
      ) : a?.checked ? (
        <>
          <p className="flex items-center gap-2 font-medium">
            <CircleDashed size={15} className="text-warning" /> Not signed in
          </p>
          <p className="text-muted">Sign in with your Claude account (Pro, Max, Team or Enterprise) in the terminal window that opens, then come back and check again.</p>
        </>
      ) : (
        <>
          <p className="font-medium">Sign-in status unknown</p>
          {a?.detail && <p className="text-muted">{a.detail}</p>}
        </>
      )}
      {auth.error && <ErrorNotice compact error={auth.error} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={a?.loggedIn ? "secondary" : "primary"} icon={<LogIn size={12} />} onClick={() => void signIn()}>
          {a?.loggedIn ? "Switch account" : "Sign in with Claude"}
        </Button>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void auth.reload()}>
          Check again
        </Button>
      </div>
      {!compact && det.data?.version && <p className="text-sm text-faint">Claude Code {det.data.version}</p>}
    </div>
  );
}
