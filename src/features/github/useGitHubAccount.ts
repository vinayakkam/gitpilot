import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

const CHANGED = "gitpilot:github-changed";

/** Tells every view showing the GitHub account to reload it (after signing in or out). */
export function githubAccountChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** The GitHub sign-in state, reloaded whenever it changes anywhere in the app. */
export function useGitHubAccount() {
  const account = useAsync(() => api.githubAccount(), []);
  const { reload } = account;
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [reload]);
  return account;
}
