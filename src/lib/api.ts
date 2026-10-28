// Typed wrappers around every Tauri command. Components never call invoke() directly.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isMainWindow } from "./windows";
import type { AiProviderKind } from "@/bindings/AiProviderKind";
import type { AiSuggestions } from "@/bindings/AiSuggestions";
import type { AiText } from "@/bindings/AiText";
import type { AppInfo } from "@/bindings/AppInfo";
import type { Area } from "@/bindings/Area";
import type { Branch } from "@/bindings/Branch";
import type { BranchComparison } from "@/bindings/BranchComparison";
import type { ClaudeAuthStatus } from "@/bindings/ClaudeAuthStatus";
import type { CliToolInfo } from "@/bindings/CliToolInfo";
import type { CommitDetail } from "@/bindings/CommitDetail";
import type { CreatedPull } from "@/bindings/CreatedPull";
import type { DeviceCode } from "@/bindings/DeviceCode";
import type { GitHubAccount } from "@/bindings/GitHubAccount";
import type { GitHubLink } from "@/bindings/GitHubLink";
import type { GitHubRepo } from "@/bindings/GitHubRepo";
import type { GitHubUser } from "@/bindings/GitHubUser";
import type { DiscardResult } from "@/bindings/DiscardResult";
import type { EolReport } from "@/bindings/EolReport";
import type { ExplainTarget } from "@/bindings/ExplainTarget";
import type { LastCommit } from "@/bindings/LastCommit";
import type { LfsStatus } from "@/bindings/LfsStatus";
import type { Backup } from "@/bindings/Backup";
import type { ConflictChoice } from "@/bindings/ConflictChoice";
import type { ConflictHelp } from "@/bindings/ConflictHelp";
import type { RebaseCommit } from "@/bindings/RebaseCommit";
import type { RebaseStep } from "@/bindings/RebaseStep";
import type { ResetMode } from "@/bindings/ResetMode";
import type { BlameResult } from "@/bindings/BlameResult";
import type { CommitFile } from "@/bindings/CommitFile";
import type { Tag } from "@/bindings/Tag";
import type { FileDiff } from "@/bindings/FileDiff";
import type { Identity } from "@/bindings/Identity";
import type { KeyStatus } from "@/bindings/KeyStatus";
import type { LogPage } from "@/bindings/LogPage";
import type { LogQuery } from "@/bindings/LogQuery";
import type { OpenRouterKeyInfo } from "@/bindings/OpenRouterKeyInfo";
import type { OpenRouterModel } from "@/bindings/OpenRouterModel";
import type { PathInspection } from "@/bindings/PathInspection";
import type { PrCheckout } from "@/bindings/PrCheckout";
import type { PullRequest } from "@/bindings/PullRequest";
import type { PrDescription } from "@/bindings/PrDescription";
import type { PullOptions } from "@/bindings/PullOptions";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import type { Remote } from "@/bindings/Remote";
import type { RepoRecord } from "@/bindings/RepoRecord";
import type { RepoStatus } from "@/bindings/RepoStatus";
import type { Settings } from "@/bindings/Settings";
import type { Signature } from "@/bindings/Signature";
import type { SigningConfig } from "@/bindings/SigningConfig";
import type { SigningFormat } from "@/bindings/SigningFormat";
import type { SigningKey } from "@/bindings/SigningKey";
import type { SigningScope } from "@/bindings/SigningScope";
import type { SequenceAction } from "@/bindings/SequenceAction";
import type { Stash } from "@/bindings/Stash";
import type { Submodule } from "@/bindings/Submodule";
import type { UpdateProgress } from "@/bindings/UpdateProgress";
import type { UpdateSupport } from "@/bindings/UpdateSupport";
import type { Worktree } from "@/bindings/Worktree";

export const api = {
  // app
  appInfo: () => invoke<AppInfo>("app_info"),
  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSave: (settings: Settings) => invoke<Settings>("settings_save", { settings }),
  secretStatus: (provider: AiProviderKind) => invoke<KeyStatus>("secret_status", { provider }),
  secretSet: (provider: AiProviderKind, key: string) => invoke<KeyStatus>("secret_set", { provider, key }),
  secretClear: (provider: AiProviderKind) => invoke<KeyStatus>("secret_clear", { provider }),
  updateSupport: () => invoke<UpdateSupport>("update_support"),
  updateInstallPacman: (onProgress: (p: UpdateProgress) => void) => {
    const ch = new Channel<UpdateProgress>();
    ch.onmessage = onProgress;
    return invoke<string>("update_install_pacman", { onProgress: ch });
  },

  // repositories
  repoList: () => invoke<RepoRecord[]>("repo_list"),
  repoInspectPath: (path: string) => invoke<PathInspection>("repo_inspect_path", { path }),
  repoAdd: (path: string) => invoke<RepoRecord>("repo_add", { path }),
  repoInit: (path: string) => invoke<RepoRecord>("repo_init", { path }),
  repoClone: (url: string, parent: string, name: string) => invoke<RepoRecord>("repo_clone", { url, parent, name }),
  repoRemove: (id: number) => invoke<void>("repo_remove", { id }),
  repoRelocate: (id: number, path: string) => invoke<RepoRecord>("repo_relocate", { id, path }),
  repoRename: (id: number, name: string) => invoke<RepoRecord>("repo_rename", { id, name }),
  /** Only the main window's choice is reopened at the next start. */
  repoOpen: (id: number) => invoke<RepoRecord>("repo_open", { id, remember: isMainWindow() }),
  /** Opens a repository in its own window, or focuses that window. */
  windowOpenRepo: (id: number) => invoke<void>("window_open_repo", { id }),
  /** Settings saved in any window. */
  onSettingsChanged: (cb: (s: Settings) => void): Promise<UnlistenFn> => listen<Settings>("settings-changed", (ev) => cb(ev.payload)),

  // working tree
  status: (id: number) => invoke<RepoStatus>("status_get", { id }),
  diffFile: (id: number, path: string, area: Area, origPath: string | null) =>
    invoke<FileDiff>("diff_file", { id, path, area, origPath }),
  stagePaths: (id: number, paths: string[]) => invoke<void>("stage_paths", { id, paths }),
  unstagePaths: (id: number, paths: string[]) => invoke<void>("unstage_paths", { id, paths }),
  stageAll: (id: number) => invoke<void>("stage_all", { id }),
  unstageAll: (id: number) => invoke<void>("unstage_all", { id }),
  repoWatch: (id: number) => invoke<void>("repo_watch", { id }),
  /** Fires when a watched repository's files change on disk. */
  onRepoChanged: (cb: (id: number) => void): Promise<UnlistenFn> => listen<number>("repo-changed", (ev) => cb(ev.payload)),
  repoUnwatch: (id: number) => invoke<void>("repo_unwatch", { id }),
  lastCommit: (id: number) => invoke<LastCommit | null>("last_commit", { id }),
  commitAmend: (id: number, message: string, confirmedPushed: boolean) => invoke<string>("commit_amend", { id, message, confirmedPushed }),
  commitUndo: (id: number, confirmedPushed: boolean) => invoke<string>("commit_undo", { id, confirmedPushed }),
  discardPartial: (id: number, path: string, header: string, lines: number[] | null) =>
    invoke<string | null>("discard_partial", { id, path, header, lines, confirmed: true }),
  stashPaths: (id: number, message: string, includeUntracked: boolean, paths: string[]) =>
    invoke<void>("stash_paths", { id, message, includeUntracked, paths }),
  fileBlame: (id: number, path: string, rev: string | null) => invoke<BlameResult>("file_blame", { id, path, rev }),
  compareFiles: (id: number, base: string, head: string, threeDot: boolean) => invoke<CommitFile[]>("compare_files", { id, base, head, threeDot }),
  compareFileDiff: (id: number, base: string, head: string, threeDot: boolean, path: string, origPath: string | null) =>
    invoke<FileDiff>("compare_file_diff", { id, base, head, threeDot, path, origPath }),
  conflictResolveBlock: (id: number, path: string, index: number, choice: ConflictChoice) => invoke<number>("conflict_resolve_block", { id, path, index, choice }),
  conflictTakeSide: (id: number, path: string, current: boolean) => invoke<void>("conflict_take_side", { id, path, current }),
  /** Replaces one conflict with `text`, only if it still reads exactly `expected`. Returns the conflicts left. */
  conflictApplyText: (id: number, path: string, index: number, expected: string, text: string) =>
    invoke<number>("conflict_apply_text", { id, path, index, expected, text }),
  rebaseCommits: (id: number, base: string | null) => invoke<RebaseCommit[]>("rebase_commits", { id, base }),
  rebaseInteractive: (id: number, base: string | null, steps: RebaseStep[], confirmedPushed: boolean) =>
    invoke<Backup>("rebase_interactive", { id, base, steps, confirmedPushed }),
  branchReset: (id: number, target: string, mode: ResetMode) => invoke<Backup>("branch_reset", { id, target, mode, confirmed: mode === "hard" }),
  backupList: (id: number) => invoke<Backup[]>("backup_list", { id }),
  backupRestore: (id: number, name: string) => invoke<void>("backup_restore", { id, name, confirmed: true }),
  backupDelete: (id: number, name: string) => invoke<void>("backup_delete", { id, name, confirmed: true }),
  tagList: (id: number) => invoke<Tag[]>("tag_list", { id }),
  tagCreate: (id: number, name: string, target: string, message: string) => invoke<void>("tag_create", { id, name, target, message }),
  tagDelete: (id: number, name: string) => invoke<void>("tag_delete", { id, name, confirmed: true }),
  tagPush: (id: number, remote: string, name: string, del: boolean) => invoke<void>("tag_push", { id, remote, name, delete: del, confirmed: del }),
  gitignoreAdd: (id: number, patterns: string[], untrack: string[]) =>
    invoke<string[]>("gitignore_add", { id, patterns, untrack, confirmed: untrack.length > 0 }),
  untrackPaths: (id: number, paths: string[]) => invoke<void>("untrack_paths", { id, paths, confirmed: true }),
  /** `withFiles` also lists LFS files and checks hooks (slower). */
  lfsStatus: (id: number, withFiles: boolean) => invoke<LfsStatus>("lfs_status", { id, withFiles }),
  lfsTrack: (id: number, pattern: string) => invoke<void>("lfs_track", { id, pattern }),
  lfsUntrack: (id: number, pattern: string) => invoke<void>("lfs_untrack", { id, pattern, confirmed: true }),
  lfsInstallHooks: (id: number) => invoke<void>("lfs_install_hooks", { id }),
  eolCheck: (id: number) => invoke<EolReport>("eol_check", { id }),
  eolFix: (id: number, paths: string[]) => invoke<number>("eol_fix", { id, paths }),
  eolAddGitattributes: (id: number) => invoke<boolean>("eol_add_gitattributes", { id }),
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
  worktreeList: (id: number) => invoke<Worktree[]>("worktree_list", { id }),
  /** Returns the new worktree's folder. */
  worktreeAdd: (id: number, path: string, branch: string, newBranch: boolean, start: string | null) =>
    invoke<string>("worktree_add", { id, path, branch, newBranch, start }),
  worktreeRemove: (id: number, path: string) => invoke<void>("worktree_remove", { id, path, confirmed: true }),
  worktreePrune: (id: number) => invoke<void>("worktree_prune", { id }),
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

  // commit signing (`id` null = global configuration)
  signingGet: (id: number | null) => invoke<SigningConfig>("signing_get", { id }),
  signingKeys: () => invoke<SigningKey[]>("signing_keys"),
  signingEnable: (id: number | null, scope: SigningScope, format: SigningFormat, key: string) =>
    invoke<SigningConfig>("signing_enable", { id, scope, format, key }),
  signingDisable: (id: number | null, scope: SigningScope) => invoke<SigningConfig>("signing_disable", { id, scope }),
  commitSignature: (id: number, hash: string) => invoke<Signature>("commit_signature", { id, hash }),

  // GitHub
  githubAccount: () => invoke<GitHubAccount>("github_account"),
  githubDeviceStart: () => invoke<DeviceCode>("github_device_start"),
  /** Resolves once the user approved the sign-in on GitHub. Cancel with opCancel("github-login"). */
  githubDeviceWait: () => invoke<GitHubUser>("github_device_wait"),
  githubTokenSet: (token: string) => invoke<GitHubUser>("github_token_set", { token }),
  githubSignOut: () => invoke<void>("github_sign_out"),
  githubRepos: () => invoke<GitHubRepo[]>("github_repos"),
  githubLink: (id: number) => invoke<GitHubLink | null>("github_link", { id }),
  githubPulls: (owner: string, name: string) => invoke<PullRequest[]>("github_pulls", { owner, name }),
  githubPullCreate: (id: number, owner: string, name: string, base: string, title: string, body: string, draft: boolean) =>
    invoke<CreatedPull>("github_pull_create", { id, owner, name, base, title, body, draft }),
  githubPullCheckout: (id: number, owner: string, name: string, number: number) =>
    invoke<PrCheckout>("github_pull_checkout", { id, owner, name, number }),

  submoduleList: (id: number) => invoke<Submodule[]>("submodule_list", { id }),
  /** Downloads and checks out submodules (`paths` empty = all). Cancellable with opCancel("repo:<id>"). */
  submoduleUpdate: (id: number, paths: string[]) => invoke<void>("submodule_update", { id, paths }),

  /** Cancels a running clone ("clone:<window label>"), a fetch/push in a repository ("repo:<id>") or a GitHub sign-in ("github-login"). */
  opCancel: (key: string) => invoke<boolean>("op_cancel", { key }),

  // assistance
  aiSuggestCommit: (id: number) => invoke<AiSuggestions>("ai_suggest_commit", { id }),
  aiExplain: (id: number, target: ExplainTarget) => invoke<AiText>("ai_explain", { id, target }),
  /** `base` is the branch the pull request goes into, as a local ref (e.g. "origin/main"). */
  aiPrDescription: (id: number, base: string) => invoke<PrDescription>("ai_pr_description", { id, base }),
  aiConflictHelp: (id: number, path: string) => invoke<ConflictHelp>("ai_conflict_help", { id, path }),
  claudeDetect: () => invoke<CliToolInfo>("claude_detect"),
  openCodeDetect: () => invoke<CliToolInfo>("opencode_detect"),
  /** Opens the coding assistant chosen in Settings in a terminal in the repository. */
  assistantLaunch: (id: number, prompt: string | null) => invoke<void>("assistant_launch", { id, prompt }),
  claudeAuthStatus: () => invoke<ClaudeAuthStatus>("claude_auth_status"),
  claudeLogin: () => invoke<void>("claude_login"),
  openRouterModels: () => invoke<OpenRouterModel[]>("openrouter_models"),
  openRouterKeyInfo: () => invoke<OpenRouterKeyInfo>("openrouter_key_info"),
};

export function onProgress(cb: (e: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("git-progress", (ev) => cb(ev.payload));
}
