// Typed wrappers around every Tauri command. Components never call invoke() directly.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiProviderKind } from "@/bindings/AiProviderKind";
import type { AiSuggestions } from "@/bindings/AiSuggestions";
import type { AppInfo } from "@/bindings/AppInfo";
import type { Area } from "@/bindings/Area";
import type { Branch } from "@/bindings/Branch";
import type { BranchComparison } from "@/bindings/BranchComparison";
import type { ClaudeCodeInfo } from "@/bindings/ClaudeCodeInfo";
import type { CommitDetail } from "@/bindings/CommitDetail";
import type { DiscardResult } from "@/bindings/DiscardResult";
import type { FileDiff } from "@/bindings/FileDiff";
import type { Identity } from "@/bindings/Identity";
import type { KeyStatus } from "@/bindings/KeyStatus";
import type { LogPage } from "@/bindings/LogPage";
import type { LogQuery } from "@/bindings/LogQuery";
import type { PathInspection } from "@/bindings/PathInspection";
import type { PullOptions } from "@/bindings/PullOptions";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import type { Remote } from "@/bindings/Remote";
import type { RepoRecord } from "@/bindings/RepoRecord";
import type { RepoStatus } from "@/bindings/RepoStatus";
import type { Settings } from "@/bindings/Settings";
import type { SequenceAction } from "@/bindings/SequenceAction";
import type { Stash } from "@/bindings/Stash";
import type { UpdateSupport } from "@/bindings/UpdateSupport";

export const api = {
  // app
  appInfo: () => invoke<AppInfo>("app_info"),
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSave: (settings: Settings) => invoke<Settings>("settings_save", { settings }),
  secretStatus: (provider: AiProviderKind) => invoke<KeyStatus>("secret_status", { provider }),
  secretSet: (provider: AiProviderKind, key: string) => invoke<KeyStatus>("secret_set", { provider, key }),
  secretClear: (provider: AiProviderKind) => invoke<KeyStatus>("secret_clear", { provider }),
  updateSupport: () => invoke<UpdateSupport>("update_support"),

  // repositories
  repoList: () => invoke<RepoRecord[]>("repo_list"),
  repoInspectPath: (path: string) => invoke<PathInspection>("repo_inspect_path", { path }),
  repoAdd: (path: string) => invoke<RepoRecord>("repo_add", { path }),
  repoInit: (path: string) => invoke<RepoRecord>("repo_init", { path }),
  repoClone: (url: string, parent: string, name: string) => invoke<RepoRecord>("repo_clone", { url, parent, name }),
  repoRemove: (id: number) => invoke<void>("repo_remove", { id }),
  repoRelocate: (id: number, path: string) => invoke<RepoRecord>("repo_relocate", { id, path }),
  repoRename: (id: number, name: string) => invoke<RepoRecord>("repo_rename", { id, name }),
  repoOpen: (id: number) => invoke<RepoRecord>("repo_open", { id }),

  // working tree
  status: (id: number) => invoke<RepoStatus>("status_get", { id }),
  diffFile: (id: number, path: string, area: Area, origPath: string | null) =>
    invoke<FileDiff>("diff_file", { id, path, area, origPath }),
  stagePaths: (id: number, paths: string[]) => invoke<void>("stage_paths", { id, paths }),
  unstagePaths: (id: number, paths: string[]) => invoke<void>("unstage_paths", { id, paths }),
  stageAll: (id: number) => invoke<void>("stage_all", { id }),
  unstageAll: (id: number) => invoke<void>("unstage_all", { id }),
  hunkApply: (id: number, path: string, header: string, unstage: boolean) =>
    invoke<void>("hunk_apply", { id, path, header, unstage }),
  discardTracked: (id: number, paths: string[]) =>
    invoke<DiscardResult>("discard_tracked", { id, paths, confirmed: true }),
  discardUntracked: (id: number, paths: string[]) =>
    invoke<DiscardResult>("discard_untracked", { id, paths, confirmed: true }),
  commit: (id: number, message: string) => invoke<string>("commit_create", { id, message }),
  identityGet: (id: number) => invoke<Identity>("identity_get", { id }),
  identitySet: (id: number, name: string, email: string, global: boolean) =>
    invoke<void>("identity_set", { id, name, email, global }),
  filesSearch: (id: number, query: string) => invoke<string[]>("files_search", { id, query }),
  linesApply: (id: number, path: string, header: string, lines: number[], unstage: boolean) =>
    invoke<void>("lines_apply", { id, path, header, lines, unstage }),

  // history
  log: (id: number, query: LogQuery) => invoke<LogPage>("log_get", { id, query }),
  commitGet: (id: number, hash: string) => invoke<CommitDetail>("commit_get", { id, hash }),
  commitDiffFile: (id: number, hash: string, path: string, origPath: string | null) =>
    invoke<FileDiff>("commit_diff_file", { id, hash, path, origPath }),

  // integrating changes
  commitRevert: (id: number, hash: string) => invoke<void>("commit_revert", { id, hash }),
  commitCherryPick: (id: number, hash: string) => invoke<void>("commit_cherry_pick", { id, hash }),
  branchMerge: (id: number, branch: string) => invoke<void>("branch_merge", { id, branch }),
  branchRebase: (id: number, onto: string) => invoke<void>("branch_rebase", { id, onto, confirmed: true }),
  sequenceRun: (id: number, action: SequenceAction) => invoke<void>("sequence_run", { id, action, confirmed: true }),

  // branches & stashes
  branches: (id: number) => invoke<Branch[]>("branch_list", { id }),
  branchCreate: (id: number, name: string, start: string | null, checkout: boolean) =>
    invoke<void>("branch_create", { id, name, start, checkout }),
  branchSwitch: (id: number, name: string) => invoke<void>("branch_switch", { id, name }),
  branchCheckoutRemote: (id: number, remoteBranch: string, localName: string) =>
    invoke<void>("branch_checkout_remote", { id, remoteBranch, localName }),
  branchRename: (id: number, old: string, next: string) => invoke<void>("branch_rename", { id, old, new: next }),
  branchDelete: (id: number, name: string, force: boolean) =>
    invoke<void>("branch_delete", { id, name, force, confirmed: true }),
  branchDeleteRemote: (id: number, remote: string, branch: string) =>
    invoke<void>("branch_delete_remote", { id, remote, branch, confirmed: true }),
  branchCompare: (id: number, base: string, head: string) =>
    invoke<BranchComparison>("branch_compare", { id, base, head }),
  branchSetUpstream: (id: number, branch: string, upstream: string | null) =>
    invoke<void>("branch_set_upstream", { id, branch, upstream }),
  stashList: (id: number) => invoke<Stash[]>("stash_list", { id }),
  stashPush: (id: number, message: string, includeUntracked: boolean) =>
    invoke<void>("stash_push", { id, message, includeUntracked }),
  stashApply: (id: number, index: number, pop: boolean) => invoke<void>("stash_apply", { id, index, pop }),
  stashDrop: (id: number, index: number) => invoke<void>("stash_drop", { id, index, confirmed: true }),

  // remotes & sync
  remotes: (id: number) => invoke<Remote[]>("remote_list", { id }),
  remoteAdd: (id: number, name: string, url: string) => invoke<void>("remote_add", { id, name, url }),
  remoteSetUrl: (id: number, name: string, url: string) => invoke<void>("remote_set_url", { id, name, url }),
  remoteRemove: (id: number, name: string) => invoke<void>("remote_remove", { id, name, confirmed: true }),
  fetch: (id: number, remote: string | null) => invoke<void>("sync_fetch", { id, remote }),
  pull: (id: number, options: PullOptions | null = null) => invoke<void>("sync_pull", { id, options }),
  push: (id: number, opts: { remote?: string | null; setUpstream?: boolean; forceWithLease?: boolean } = {}) =>
    invoke<void>("sync_push", {
      id,
      remote: opts.remote ?? null,
      setUpstream: opts.setUpstream ?? false,
      forceWithLease: opts.forceWithLease ?? false,
      confirmedForce: opts.forceWithLease ?? false,
    }),

  /** Cancels a running clone ("clone") or a fetch/push in a repository ("repo:<id>"). */
  opCancel: (key: string) => invoke<boolean>("op_cancel", { key }),

  // assistance
  aiSuggestCommit: (id: number) => invoke<AiSuggestions>("ai_suggest_commit", { id }),
  claudeDetect: () => invoke<ClaudeCodeInfo>("claude_detect"),
  claudeLaunch: (id: number, prompt: string | null) => invoke<void>("claude_launch", { id, prompt }),
};

export function onProgress(cb: (e: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("git-progress", (ev) => cb(ev.payload));
}
