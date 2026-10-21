import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppError } from "@/bindings/AppError";
import type { AppInfo } from "@/bindings/AppInfo";
import type { RepoRecord } from "@/bindings/RepoRecord";
import type { RepoStatus } from "@/bindings/RepoStatus";
import type { Settings } from "@/bindings/Settings";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { applyAccent } from "@/lib/accent";
import { LINK_FAILED_EVENT } from "@/lib/links";
import { api, onProgress } from "@/lib/api";
import { toAppError } from "@/lib/errors";

export type Section = "overview" | "changes" | "history" | "branches" | "remotes" | "assistant";
export type Page = "repo" | "repositories" | "settings";

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  error?: AppError;
  body?: string;
  /** Optional button, e.g. "Pull" on a rejected push. */
  action?: { label: string; run: () => void };
}

interface RunOptions {
  /** Toast shown on success (only if success notifications are enabled). */
  success?: string;
  /** Re-read repository status afterwards (default true). */
  refresh?: boolean;
  /** Rethrow after reporting, so callers can keep dialogs open. */
  rethrow?: boolean;
  /** Don't show an error toast (the caller displays the error inline). */
  quiet?: boolean;
}

interface Store {
  info: AppInfo | null;
  settings: Settings | null;
  repos: RepoRecord[];
  activeRepo: RepoRecord | null;
  page: Page;
  section: Section;
  status: RepoStatus | null;
  statusError: AppError | null;
  statusLoading: boolean;
  /** Label of the operation in progress (one at a time per window). */
  busy: string | null;
  progress: string | null;
  /** Increments after every successful mutating operation; views refetch on change. */
  revision: number;
  toasts: Toast[];
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  /** File path the History view should filter to (set from other views). */
  historyPath: string | null;
  setHistoryPath: (p: string | null) => void;
  /** A search the History view should apply once (e.g. a commit picked in the palette). */
  historyJump: string | null;
  setHistoryJump: (q: string | null) => void;
  setPage: (p: Page) => void;
  setSection: (s: Section) => void;
  openRepo: (id: number) => Promise<void>;
  refreshRepos: () => Promise<RepoRecord[]>;
  refreshStatus: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  saveSettings: (patch: Partial<Settings> | ((s: Settings) => Settings)) => Promise<boolean>;
  run: <T>(label: string, fn: () => Promise<T>, opts?: RunOptions) => Promise<T | undefined>;
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  bump: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <AppStoreProvider>");
  return s;
}

let toastId = 0;

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [page, setPage] = useState<Page>("repo");
  const [section, setSection] = useState<Section>("changes");
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [statusError, setStatusError] = useState<AppError | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [historyJump, setHistoryJump] = useState<string | null>(null);
  const busyRef = useRef(false);
  const statusSeq = useRef(0);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    if (t.tone !== "error") window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  // Links that couldn't be opened (see lib/links.ts) get a message with a way to copy them.
  useEffect(() => {
    const onFail = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      notify({
        tone: "error",
        title: "Couldn't open your browser",
        body: url,
        action: { label: "Copy link", run: () => void writeText(url).then(() => notify({ tone: "success", title: "Link copied" })) },
      });
    };
    window.addEventListener(LINK_FAILED_EVENT, onFail);
    return () => window.removeEventListener(LINK_FAILED_EVENT, onFail);
  }, [notify]);

  const refreshStatus = useCallback(async () => {
    const id = activeIdRef.current;
    if (id == null) return;
    const seq = ++statusSeq.current;
    setStatusLoading(true);
    try {
      const s = await api.status(id);
      if (seq === statusSeq.current && activeIdRef.current === id) {
        setStatus(s);
        setStatusError(null);
      }
    } catch (e) {
      if (seq === statusSeq.current) {
        setStatus(null);
        setStatusError(toAppError(e));
      }
    } finally {
      if (seq === statusSeq.current) setStatusLoading(false);
    }
  }, []);

  const refreshRepos = useCallback(async () => {
    const list = await api.repoList();
    setRepos(list);
    return list;
  }, []);

  const refreshInfo = useCallback(async () => {
    setInfo(await api.appInfo());
  }, []);

  const openRepo = useCallback(
    async (id: number) => {
      setStatus(null);
      setStatusError(null);
      setHistoryPath(null);
      setActiveId(id);
      activeIdRef.current = id;
      setPage("repo");
      try {
        await api.repoOpen(id);
        await refreshRepos();
      } catch (e) {
        notify({ tone: "error", title: "Couldn't open the repository", error: toAppError(e) });
      }
      await refreshStatus();
    },
    [refreshRepos, refreshStatus, notify],
  );

  const saveSettings = useCallback(
    async (patch: Partial<Settings> | ((s: Settings) => Settings)) => {
      const cur = settingsRef.current;
      if (!cur) return false;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      setSettings(next); // optimistic
      try {
        setSettings(await api.settingsSave(next));
        return true;
      } catch (e) {
        setSettings(cur);
        notify({ tone: "error", title: "Settings weren't saved", error: toAppError(e) });
        return false;
      }
    },
    [notify],
  );

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, opts: RunOptions = {}): Promise<T | undefined> => {
      if (busyRef.current) {
        notify({ tone: "info", title: "Another operation is still running. Try again when it finishes." });
        return undefined;
      }
      busyRef.current = true;
      setBusy(label);
      setProgress(null);
      try {
        const out = await fn();
        setRevision((r) => r + 1);
        if (opts.success && settingsRef.current?.successNotifications !== false) notify({ tone: "success", title: opts.success });
        return out;
      } catch (e) {
        const err = toAppError(e);
        if (err.kind === "cancelled") notify({ tone: "info", title: `${label} cancelled` });
        else if (!opts.quiet) notify({ tone: "error", title: `${label} failed`, error: err });
        if (opts.rethrow) throw err;
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(null);
        setProgress(null);
        if (opts.refresh !== false) void refreshStatus();
      }
    },
    [notify, refreshStatus],
  );

  // Boot: settings, app info, repositories, last repository.
  useEffect(() => {
    (async () => {
      try {
        const [s, list] = await Promise.all([api.settingsGet(), api.repoList()]);
        setSettings(s);
        setRepos(list);
        api.appInfo().then(setInfo, () => undefined);
        const last = s.reopenLastRepo ? list.find((r) => r.id === s.lastRepoId && r.available) : undefined;
        if (last) void openRepo(last.id);
        else setPage(list.length ? "repositories" : "repo");
      } catch (e) {
        notify({ tone: "error", title: "GitPilot couldn't load its settings", error: toAppError(e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress lines from long-running git operations.
  useEffect(() => {
    const un = onProgress((e) => {
      if (e.repoId == null || e.repoId === activeIdRef.current) setProgress(e.line);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Refresh when the window regains focus (the user may have used git elsewhere).
  useEffect(() => {
    const onFocus = () => {
      if (!busyRef.current) void refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  // Theme + density.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.dataset.density = settings.density;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = settings.theme === "system" ? (mq.matches ? "dark" : "light") : settings.theme;
      root.dataset.theme = theme;
      applyAccent(root, settings.accent, theme);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  const activeRepo = useMemo(() => repos.find((r) => r.id === activeId) ?? null, [repos, activeId]);

  const value: Store = {
    info,
    settings,
    repos,
    activeRepo,
    page,
    section,
    status,
    statusError,
    statusLoading,
    busy,
    progress,
    revision,
    toasts,
    paletteOpen,
    setPaletteOpen,
    historyPath,
    setHistoryPath,
    historyJump,
    setHistoryJump,
    setPage,
    setSection: (s) => {
      setSection(s);
      setPage("repo");
    },
    openRepo,
    refreshRepos,
    refreshStatus,
    refreshInfo,
    saveSettings,
    run,
    notify,
    dismiss,
    bump: () => setRevision((r) => r + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
