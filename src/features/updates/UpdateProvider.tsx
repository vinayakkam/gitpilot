import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppError } from "@/bindings/AppError";
import type { UpdateSupport } from "@/bindings/UpdateSupport";
import { api } from "@/lib/api";
import { isMainWindow } from "@/lib/windows";
import { useStore } from "@/store/AppStore";

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate"; at: number }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; done: number; total: number | null }
  | { kind: "installing"; update: Update }
  | { kind: "restartPending"; update: Update }
  | { kind: "error"; error: AppError; update?: Update };

interface Ctx {
  phase: UpdatePhase;
  support: UpdateSupport | null;
  dialogOpen: boolean;
  setDialogOpen: (v: boolean) => void;
  checkNow: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

const UpdateCtx = createContext<Ctx | null>(null);

export function useUpdates(): Ctx {
  const c = useContext(UpdateCtx);
  if (!c) throw new Error("useUpdates outside provider");
  return c;
}

const LAST_CHECK = "gp.update.lastCheck";
const DAY = 24 * 60 * 60 * 1000;

function friendly(e: unknown, fallback: string): AppError {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  let message = fallback;
  if (/signature/i.test(raw)) message = "The downloaded update failed its signature check, so it wasn't installed.";
  else if (/network|dns|connect|timed? ?out|error sending request/i.test(raw)) message = "Couldn't reach GitHub to check for updates. Check your internet connection.";
  else if (/404|not found|release json/i.test(raw)) message = "No published update information was found yet.";
  else if (/permission|denied|access/i.test(raw)) message = "The update couldn't be installed because permission was denied.";
  return { kind: "internal", message, detail: raw };
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { settings, notify } = useStore();
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [support, setSupport] = useState<UpdateSupport | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const busy = useRef(false);
  const startupDone = useRef(false);

  useEffect(() => {
    api.updateSupport().then(setSupport, () => setSupport(null));
  }, []);

  const checkNow = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setPhase({ kind: "checking" });
      try {
        const update = await check({ timeout: 30_000 });
        try {
          localStorage.setItem(LAST_CHECK, String(Date.now()));
        } catch {
          /* not remembered */
        }
        if (update) {
          setPhase({ kind: "available", update });
          if (silent) notify({ tone: "info", title: `GitPilot ${update.version} is available`, body: "Open the update notice in the sidebar to see what's new." });
          else setDialogOpen(true);
        } else {
          setPhase({ kind: "upToDate", at: Date.now() });
          if (!silent) notify({ tone: "success", title: "GitPilot is up to date" });
        }
      } catch (e) {
        const error = friendly(e, "Checking for updates failed.");
        // A failed background check shouldn't interrupt anyone.
        setPhase(silent ? { kind: "idle" } : { kind: "error", error });
      } finally {
        busy.current = false;
      }
    },
    [notify],
  );

  // Background check shortly after startup, at most once a day.
  useEffect(() => {
    // Only the main window checks at startup, so repository windows don't repeat it.
    if (!settings || startupDone.current || !settings.checkForUpdates || !support || support.installKind === "dev" || !isMainWindow()) return;
    startupDone.current = true;
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_CHECK)) || 0;
    } catch {
      /* ignore */
    }
    if (Date.now() - last < DAY) return;
    const t = window.setTimeout(() => void checkNow({ silent: true }), 4000);
    return () => window.clearTimeout(t);
  }, [settings, support, checkNow]);

  const install = useCallback(async () => {
    if (phase.kind !== "available" && !(phase.kind === "error" && phase.update)) return;
    const update = phase.kind === "available" ? phase.update : phase.update!;
    if (busy.current) return;
    busy.current = true;
    let done = 0;
    let total: number | null = null;
    setPhase({ kind: "downloading", update, done, total });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? null;
          setPhase({ kind: "downloading", update, done: 0, total });
        } else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setPhase({ kind: "downloading", update, done, total });
        } else if (ev.event === "Finished") {
          setPhase({ kind: "installing", update });
        }
      });
      // On Windows the installer closes GitPilot itself; elsewhere we restart into the new version.
      setPhase({ kind: "restartPending", update });
    } catch (e) {
      setPhase({ kind: "error", error: friendly(e, "The update couldn't be installed. GitPilot is unchanged."), update });
    } finally {
      busy.current = false;
    }
  }, [phase]);

  const restart = useCallback(async () => {
    await relaunch();
  }, []);

  return (
    <UpdateCtx.Provider value={{ phase, support, dialogOpen, setDialogOpen, checkNow, install, restart }}>
      {children}
    </UpdateCtx.Provider>
  );
}
