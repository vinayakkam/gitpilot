import type { RepoStatus } from "@/bindings/RepoStatus";
import type { Settings } from "@/bindings/Settings";

export const settings: Settings = {
  settingsVersion: 2,
  theme: "light",
  accent: "blue",
  density: "comfortable",
  diffMode: "unified",
  syntaxHighlighting: true,
  gitPath: "",
  defaultBranch: "",
  pullStrategy: "ffOnly",
  commitConvention: "none",
  checkLineEndings: true,
  ai: { enabled: false, provider: "openRouter", model: "openrouter/auto", baseUrl: "", includeBody: true, privacyAcknowledged: false },
  claudeCode: { path: "", terminal: "", sendPromptOnLaunch: true },
  reopenLastRepo: true,
  successNotifications: true,
  checkForUpdates: true,
  lastRepoId: 1,
};

export const repo = { id: 1, path: "/work/acme", name: "acme", addedAt: 1, lastOpenedAt: 2, available: true };

export function status(files: RepoStatus["files"] = []): RepoStatus {
  return {
    branch: { head: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0, detached: false, unborn: false },
    files,
    state: "normal",
    lastFetch: null,
    stashCount: 0,
    remoteTwin: null,
  };
}
