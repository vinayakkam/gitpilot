import { useState } from "react";
import { CircleCheck, CircleDashed, LogIn, LogOut, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { openLink } from "@/lib/links";
import { useStore } from "@/store/AppStore";
import { SignInDialog } from "./SignInDialog";
import { githubAccountChanged, useGitHubAccount } from "./useGitHubAccount";

/** GitHub sign-in state with Sign in / Sign out. `compact` leaves out the explanations. */
export function GitHubAccountCard({ compact }: { compact?: boolean }) {
  const { run } = useStore();
  const account = useGitHubAccount();
  const [signIn, setSignIn] = useState(false);
  const [signOut, setSignOut] = useState(false);
  const a = account.data;

  if (account.loading && !a) return <Spinner label="Checking your GitHub sign-in" />;

  const fromEnv = a?.tokenSource != null && a.tokenSource !== "keychain";
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-2 p-3 text-base">
      {a?.user ? (
        <>
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck size={15} className="text-success" /> Signed in as{" "}
            <button type="button" className="text-accent-text hover:underline" onClick={() => void openLink(a.user!.htmlUrl)}>
              {a.user.login}
            </button>
            {a.user.name && <span className="font-normal text-muted">({a.user.name})</span>}
          </p>
          {fromEnv && <p className="text-sm text-muted">Using the token from the {a.tokenSource} environment variable.</p>}
        </>
      ) : a?.tokenRejected ? (
        <>
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert size={15} className="text-warning" /> GitHub no longer accepts your sign-in
          </p>
          <p className="text-muted">
            {fromEnv ? `The token in ${a.tokenSource} has expired or was revoked. Update or remove that environment variable.` : "It may have expired or been revoked. Sign in again."}
          </p>
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 font-medium">
            <CircleDashed size={15} className="text-faint" /> Not signed in to GitHub
          </p>
          {!compact && <p className="text-muted">Sign in to clone from your repository list, see pull requests with their checks, and open new ones.</p>}
          {a && !a.keychainAvailable && (
            <p className="text-sm text-warning">The system keychain isn't available, so a sign-in can't be kept. Set the GITPILOT_GITHUB_TOKEN environment variable before starting GitPilot instead.</p>
          )}
        </>
      )}
      {account.error && <ErrorNotice compact error={account.error} />}
      <div className="flex flex-wrap gap-2">
        {!a?.user && !fromEnv && (
          <Button size="sm" variant="primary" icon={<LogIn size={12} />} disabled={a?.keychainAvailable === false} onClick={() => setSignIn(true)}>
            {a?.tokenRejected ? "Sign in again" : "Sign in to GitHub"}
          </Button>
        )}
        {a?.tokenSource === "keychain" && (
          <Button size="sm" icon={<LogOut size={12} />} onClick={() => setSignOut(true)}>
            Sign out
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void account.reload()}>
          Check again
        </Button>
      </div>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} deviceFlow={a?.deviceFlow ?? false} />
      <ConfirmDialog
        open={signOut}
        onClose={() => setSignOut(false)}
        title="Sign out of GitHub?"
        confirmLabel="Sign out"
        onConfirm={async () => {
          await run("Sign out", () => api.githubSignOut(), { refresh: false, rethrow: true, success: "Signed out of GitHub" });
          githubAccountChanged();
        }}
      >
        <p>GitPilot removes its saved token from your keychain. To revoke it on GitHub as well, go to GitHub → Settings → Applications (or Developer settings → Tokens).</p>
      </ConfirmDialog>
    </div>
  );
}
