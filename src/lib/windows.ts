import { getCurrentWindow } from "@tauri-apps/api/window";

/** This window's label: "main", or "repo-<id>" for a repository opened in its own window. */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main"; // outside Tauri (tests, plain browser)
  }
}

export function isMainWindow(): boolean {
  return windowLabel() === "main";
}

/** The repository this window was opened for, if it's a repository window. */
export function windowRepoId(label: string = windowLabel()): number | null {
  const m = /^repo-(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}
