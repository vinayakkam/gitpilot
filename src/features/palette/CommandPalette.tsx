import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  ArrowUpFromLine,
  DownloadCloud,
  FileClock,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  RefreshCw,
  Settings as SettingsIcon,
  SquareTerminal,
} from "lucide-react";
import type { Branch } from "@/bindings/Branch";
import type { CommitSummary } from "@/bindings/CommitSummary";
import type { Remote } from "@/bindings/Remote";
import { cx } from "@/components/ui/cx";
import { Kbd } from "@/components/ui/Misc";
import { SECTIONS } from "@/components/layout/Sidebar";
import { Spinner } from "@/components/ui/Spinner";
import { NewBranchDialog } from "@/features/branches/NewBranchDialog";
import { useBranchSwitch } from "@/features/branches/useBranchSwitch";
import { usePull } from "@/features/sync/usePull";
import { useRepoActions } from "@/features/onboarding/RepoActions";
import { ASSISTANT_TOOLS } from "@/features/assistant/tools";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { modKey } from "@/lib/platform";
import { useDebounced } from "@/lib/useAsync";
import { useOpenWindow } from "@/features/repositories/useOpenWindow";
import { useStore } from "@/store/AppStore";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const store = useStore();
  const openWindow = useOpenWindow();
  const toolId = store.settings?.assistantTool ?? "claudeCode";
  const { paletteOpen, setPaletteOpen, activeRepo, status, repos, run } = store;
  const { addExisting, startClone, createNew } = useRepoActions();
  const { request: switchTo, dialog: switchDialog } = useBranchSwitch();
  const { pull, dialog: pullDialog } = usePull();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 180);
  const [active, setActive] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [claudeFound, setClaudeFound] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [newBranch, setNewBranch] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const id = activeRepo?.id;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (paletteOpen && !d.open) {
      d.showModal();
      setQ("");
      setActive(0);
      setFiles([]);
      setCommits([]);
      if (id != null) {
        api.branches(id).then(setBranches, () => setBranches([]));
        api.remotes(id).then(setRemotes, () => setRemotes([]));
      }
      ASSISTANT_TOOLS[toolId].detect().then((c) => setClaudeFound(c.found), () => setClaudeFound(false));
    }
    if (!paletteOpen && d.open) d.close();
  }, [paletteOpen, id, toolId]);

  // Debounced file and commit search.
  useEffect(() => {
    if (!paletteOpen || id == null || dq.trim().length < 2) {
      setFiles([]);
      setCommits([]);
      return;
    }
    let c = false;
    setSearching(true);
    setSearchError(false);
    Promise.all([
      api.filesSearch(id, dq.trim()),
      status?.branch.unborn ? Promise.resolve({ commits: [], hasMore: false }) : api.log(id, { rev: null, skip: 0, limit: 8, search: dq.trim(), path: null }),
    ])
      .then(([f, l]) => {
        if (c) return;
        setFiles(f.slice(0, 8));
        setCommits(l.commits);
      })
      .catch(() => !c && setSearchError(true))
      .finally(() => !c && setSearching(false));
    return () => {
      c = true;
    };
  }, [dq, id, paletteOpen, status?.branch.unborn]);

  const close = () => setPaletteOpen(false);
  const b = status?.branch;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const f = q.trim().toLowerCase();
    const match = (s: string) => !f || s.toLowerCase().includes(f);
    if (activeRepo && id != null) {
      for (const s of SECTIONS) out.push({ id: `go-${s.id}`, group: "Go to", label: s.label, hint: `${modKey}+${s.key}`, icon: s.icon, run: () => store.setSection(s.id) });
      if (remotes.length) out.push({ id: "fetch", group: "Actions", label: "Fetch", icon: <RefreshCw size={15} />, run: () => void run("Fetch", () => api.fetch(id, null), { success: "Fetched from all remotes" }) });
      const pullFrom = b?.upstream ?? status?.remoteTwin?.name;
      if (pullFrom) out.push({ id: "pull", group: "Actions", label: `Pull from ${pullFrom}`, icon: <ArrowDownToLine size={15} />, run: () => void pull() });
      if (b && !b.unborn && !b.detached && (b.upstream || remotes.length))
        out.push({ id: "push", group: "Actions", label: b.upstream ? `Push to ${b.upstream}` : "Publish branch", icon: <ArrowUpFromLine size={15} />, run: () => void run("Push", () => api.push(id, { setUpstream: !b.upstream }), { success: "Pushed" }) });
      if (b && !b.unborn) out.push({ id: "new-branch", group: "Actions", label: "Create branch…", icon: <GitBranchPlus size={15} />, run: () => setNewBranch(true) });
      if (claudeFound) {
        const tool = ASSISTANT_TOOLS[toolId].name;
        out.push({ id: "claude", group: "Actions", label: `Open ${tool} in this repository`, icon: <SquareTerminal size={15} />, run: () => void api.assistantLaunch(id, null).catch((e) => store.notify({ tone: "error", title: `Couldn't open ${tool}`, error: toAppError(e) })) });
      }
      for (const br of branches.filter((x) => !x.isRemote && !x.isCurrent).slice(0, f ? 50 : 5))
        out.push({ id: `br-${br.name}`, group: "Switch branch", label: br.name, icon: <GitBranch size={15} />, run: () => switchTo({ kind: "local", name: br.name }) });
    }
    for (const r of repos.filter((r) => r.id !== id && r.available)) {
      out.push({ id: `repo-${r.id}`, group: "Repositories", label: r.name, hint: r.path, icon: <FolderGit2 size={15} />, run: () => void store.openRepo(r.id) });
      // Only while searching, so the unfiltered list doesn't show every repository twice.
      if (f) out.push({ id: `repo-window-${r.id}`, group: "Repositories", label: `${r.name} in a new window`, hint: r.path, icon: <AppWindow size={15} />, run: () => void openWindow({ id: r.id }) });
    }
    out.push(
      { id: "open", group: "Repositories", label: "Open a repository…", icon: <FolderOpen size={15} />, run: () => void addExisting() },
      { id: "clone", group: "Repositories", label: "Clone a repository…", icon: <DownloadCloud size={15} />, run: startClone },
      { id: "create", group: "Repositories", label: "Create a new repository…", icon: <FolderPlus size={15} />, run: () => void createNew() },
      { id: "settings", group: "App", label: "Settings", hint: `${modKey}+,`, icon: <SettingsIcon size={15} />, run: () => store.setPage("settings") },
    );
    const filtered = out.filter((i) => match(i.label) || (i.group === "Repositories" && i.hint && match(i.hint)));
    for (const p of files)
      filtered.push({ id: `file-${p}`, group: "Files", label: p, hint: "history", icon: <FileClock size={15} />, run: () => { store.setHistoryPath(p); store.setSection("history"); } });
    for (const c of commits)
      filtered.push({ id: `c-${c.hash}`, group: "Commits", label: c.subject, hint: c.shortHash, icon: <GitCommitHorizontal size={15} />, run: () => { store.setHistoryPath(null); store.setHistoryJump(c.hash); store.setSection("history"); } });
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeRepo, id, b, remotes, branches, claudeFound, repos, files, commits, status?.remoteTwin, toolId]);

  useEffect(() => setActive(0), [q]);

  const choose = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };

  let lastGroup = "";
  return (
    <>
      <dialog
        ref={ref}
        aria-label="Command palette"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onMouseDown={(e) => e.target === ref.current && close()}
        className="gp-pop mx-auto mt-[12vh] w-[560px] max-w-[calc(100vw-48px)] overflow-hidden rounded-md border border-border bg-surface p-0 text-text shadow-overlay"
      >
        {paletteOpen && (
          <div
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[active]);
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <input
                autoFocus
                aria-label="Search commands, branches, files and commits"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `pal-${items[active]!.id}` : undefined}
                placeholder={activeRepo ? "Search actions, branches, files, commits…" : "Search actions and repositories…"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-11 flex-1 bg-transparent text-md outline-none placeholder:text-faint"
                spellCheck={false}
              />
              {searching && <Spinner size={13} />}
            </div>
            <div id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto py-1">
              {items.length === 0 && !searching && <p className="px-4 py-6 text-center text-base text-muted">No results for “{q}”.</p>}
              {searchError && <p className="px-4 py-2 text-sm text-danger">File and commit search failed.</p>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {header && <div className="px-3 pb-1 pt-2 text-xs font-medium text-faint">{header}</div>}
                    <div
                      id={`pal-${it.id}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => choose(it)}
                      className={cx("mx-1 flex h-8 items-center gap-2.5 rounded px-2 text-base", i === active && "bg-selection")}
                    >
                      <span className="text-muted">{it.icon}</span>
                      <span className={cx("min-w-0 flex-1 truncate", (it.group === "Files" || it.group === "Switch branch") && "font-mono text-sm")}>{it.label}</span>
                      {it.hint && <span className="max-w-[40%] truncate text-xs text-faint">{it.hint}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-faint">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>Enter</Kbd> run</span>
              <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
            </div>
          </div>
        )}
      </dialog>
      <NewBranchDialog open={newBranch} onClose={() => setNewBranch(false)} />
      {switchDialog}
      {pullDialog}
    </>
  );
}
