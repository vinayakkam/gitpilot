import { useEffect, useState } from "react";
import {
  ChevronsUpDown,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/IconButton";
import { Logo } from "@/components/ui/Logo";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Kbd } from "@/components/ui/Misc";
import { Tooltip } from "@/components/ui/Tooltip";
import { useRepoActions } from "@/features/onboarding/RepoActions";
import { UpdateNotice } from "@/features/updates/UpdateNotice";
import { modKey } from "@/lib/platform";
import { useStore, type Section } from "@/store/AppStore";

export const SECTIONS: { id: Section; label: string; icon: ReactNode; key: string }[] = [
  { id: "overview", label: "Overview", icon: <LayoutList size={16} />, key: "1" },
  { id: "changes", label: "Changes", icon: <FileDiff size={16} />, key: "2" },
  { id: "history", label: "History", icon: <History size={16} />, key: "3" },
  { id: "branches", label: "Branches", icon: <GitBranch size={16} />, key: "4" },
  { id: "remotes", label: "Remotes", icon: <Server size={16} />, key: "5" },
  { id: "assistant", label: "Assistant", icon: <Sparkles size={16} />, key: "6" },
  { id: "pulls", label: "Pull requests", icon: <GitPullRequest size={16} />, key: "7" },
];

function NavItem({
  icon,
  label,
  active,
  onClick,
  collapsed,
  trailing,
  shortcut,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  collapsed: boolean;
  trailing?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
}) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cx(
        "relative flex h-[30px] w-full items-center gap-2.5 rounded px-2 text-base transition-colors disabled:opacity-40",
        active ? "bg-surface-3 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" aria-hidden />}
      <span className={active ? "text-accent-text" : undefined}>{icon}</span>
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!collapsed && trailing}
    </button>
  );
  return collapsed ? <Tooltip content={shortcut ? `${label}  ${shortcut}` : label}>{btn}</Tooltip> : btn;
}

const NARROW = "(max-width: 1000px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export function Sidebar() {
  const { repos, activeRepo, page, section, setPage, setSection, openRepo, status, setPaletteOpen } = useStore();
  const { addExisting, startClone, createNew } = useRepoActions();
  const [pinnedCollapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("gp.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  // Narrow windows collapse the sidebar on their own; expanding it then lasts until the width changes.
  const narrow = useMediaQuery(NARROW);
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => setNarrowOpen(false), [narrow]);
  const collapsed = narrow ? !narrowOpen : pinnedCollapsed;
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const toggle = () => {
    if (narrow) return setNarrowOpen((o) => !o);
    setCollapsed((c) => {
      try {
        localStorage.setItem("gp.sidebar", c ? "open" : "collapsed");
      } catch {
        /* not remembered */
      }
      return !c;
    });
  };

  const changeCount = status ? new Set(status.files.map((f) => f.path)).size : 0;
  const conflicts = status?.files.some((f) => f.area === "conflicted") ?? false;

  const repoMenu: MenuItem[] = [
    ...(repos.length ? [{ type: "label" as const, label: "Recent repositories" }] : []),
    ...repos.slice(0, 9).map((r) => ({
      label: r.name,
      icon: r.id === activeRepo?.id ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : undefined,
      hint: r.available ? undefined : "missing",
      onSelect: () => void openRepo(r.id),
    })),
    ...(repos.length ? [{ type: "separator" as const }] : []),
    { label: "Open a repository…", icon: <FolderGit2 size={14} />, onSelect: () => void addExisting() },
    { label: "Clone a repository…", icon: <Plus size={14} />, onSelect: startClone },
    { label: "Create a new repository…", icon: <Plus size={14} />, onSelect: () => void createNew() },
    { type: "separator" },
    { label: "Manage repositories", icon: <LayoutList size={14} />, onSelect: () => setPage("repositories") },
  ];

  return (
    <nav
      aria-label="Main"
      className={cx("flex h-full shrink-0 flex-col border-r border-border bg-bg", collapsed ? "w-[52px]" : "w-[224px]")}
    >
      <div className={cx("flex h-11 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        {!collapsed && <Logo size={18} />}
        {!collapsed && <span className="flex-1 text-md font-semibold tracking-tight">GitPilot</span>}
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          icon={collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          size="sm"
          onClick={toggle}
        />
      </div>

      <div className={cx("px-2 pb-2", collapsed && "px-1.5")}>
        <Tooltip content={collapsed ? (activeRepo?.name ?? "Choose a repository") : ""}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-label={`Repository: ${activeRepo?.name ?? "none selected"}. Switch repository`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt({ x: r.left, y: r.bottom + 4 });
            }}
            className={cx(
              "flex w-full items-center gap-2 rounded border border-border bg-surface text-left hover:border-border-strong",
              collapsed ? "h-9 justify-center" : "h-11 px-2.5",
            )}
          >
            <FolderGit2 size={16} className="shrink-0 text-muted" />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{activeRepo?.name ?? "No repository"}</span>
                <span className="block truncate text-xs text-faint">
                  {activeRepo ? (status?.branch.head ?? (status?.branch.detached ? "detached HEAD" : "…")) : "Choose or add one"}
                </span>
              </span>
            )}
            {!collapsed && <ChevronsUpDown size={14} className="shrink-0 text-faint" />}
          </button>
        </Tooltip>
      </div>

      <div className={cx("flex flex-1 flex-col gap-px overflow-y-auto px-2", collapsed && "px-1.5")}>
        {SECTIONS.map((s) => (
          <NavItem
            key={s.id}
            icon={s.icon}
            label={s.label}
            collapsed={collapsed}
            shortcut={`${modKey}+${s.key}`}
            disabled={!activeRepo}
            active={page === "repo" && section === s.id && !!activeRepo}
            onClick={() => setSection(s.id)}
            trailing={
              s.id === "changes" && changeCount > 0 ? (
                <span className={cx("flex items-center gap-1 text-xs tabular-nums", conflicts ? "text-conflict" : "text-faint")}>
                  {conflicts && <TriangleAlert size={12} aria-label="Conflicts" />}
                  {changeCount}
                </span>
              ) : undefined
            }
          />
        ))}
      </div>

      <div className={cx("flex flex-col gap-px border-t border-border p-2", collapsed && "px-1.5")}>
        <UpdateNotice collapsed={collapsed} />
        <NavItem
          icon={<Search size={16} />}
          label="Go to…"
          collapsed={collapsed}
          shortcut={`${modKey}+K`}
          onClick={() => setPaletteOpen(true)}
          trailing={<Kbd>{modKey}+K</Kbd>}
        />
        <NavItem
          icon={<FolderGit2 size={16} />}
          label="Repositories"
          collapsed={collapsed}
          active={page === "repositories"}
          onClick={() => setPage("repositories")}
        />
        <NavItem
          icon={<SettingsIcon size={16} />}
          label="Settings"
          collapsed={collapsed}
          shortcut={`${modKey}+,`}
          active={page === "settings"}
          onClick={() => setPage("settings")}
        />
      </div>
      {menuAt && <Menu at={menuAt} items={repoMenu} onClose={() => setMenuAt(null)} minWidth={240} />}
    </nav>
  );
}
