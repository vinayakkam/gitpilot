import type { AppError } from "@/bindings/AppError";
import type { ErrorKind } from "@/bindings/ErrorKind";

const KINDS = new Set<string>([
  "gitNotFound", "notARepository", "pathNotFound", "invalidInput", "missingIdentity", "nothingToCommit",
  "emptyMessage", "hookFailed", "signingFailed", "conflict", "locked", "authFailed", "networkFailed",
  "pushRejected", "noUpstream", "diverged", "unrelatedHistories", "localChangesWouldBeOverwritten", "branchNotMerged", "alreadyExists",
  "permissionDenied", "timeout", "cancelled", "database", "settings", "aiNotConfigured", "aiFailed",
  "claudeCodeNotFound", "githubNotSignedIn", "githubFailed", "launchFailed", "keychain", "git", "internal",
]);

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e && KINDS.has(String((e as AppError).kind));
}

/** Normalizes anything thrown by invoke() (or JS) into an AppError. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong.";
  return { kind: "internal" as ErrorKind, message, detail: null };
}
