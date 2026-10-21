import { useMemo, useState, type ReactNode } from "react";
import { Download, GitBranch, Info, Palette, Search, Settings2, Sparkles, Terminal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Settings } from "@/bindings/Settings";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field, Input, Select, Switch } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { UpdateSettings } from "@/features/updates/UpdateSettings";
import { AiPane } from "./AiPane";
import { AppearancePane } from "./AppearancePane";
import { ClaudeAccount } from "./ClaudeAccount";
import { Group, PaneHeader, TextSetting, type PaneProps } from "./parts";

type Tab = "general" | "appearance" | "git" | "ai" | "claude" | "updates" | "about";

/** Sections, in order, with words people might search for. */
const TABS: { id: Tab; label: string; icon: ReactNode; keywords: string }[] = [
  { id: "general", label: "General", icon: <Settings2 size={15} />, keywords: "startup reopen last repository notifications success toast repositories" },
  { id: "appearance", label: "Appearance", icon: <Palette size={15} />, keywords: "theme dark light system accent colour color blue custom density compact diff layout side by side unified syntax highlighting" },
  { id: "git", label: "Git", icon: <GitBranch size={15} />, keywords: "git executable path identity name email initial branch main pull strategy fast-forward merge rebase commit message conventional line endings crlf lf gitattributes windows github pull request context" },
  { id: "ai", label: "AI", icon: <Sparkles size={15} />, keywords: "ai commit message suggestions openrouter model key api anthropic claude openai ollama lm studio privacy provider free" },
  { id: "claude", label: "Claude Code", icon: <Terminal size={15} />, keywords: "claude code account sign in login subscription terminal executable path launch prompt" },
  { id: "updates", label: "Updates", icon: <Download size={15} />, keywords: "update version check automatic install restart release" },
  { id: "about", label: "About", icon: <Info size={15} />, keywords: "about version platform data folder backups website github" },
];

export function SettingsView() {
  const { settings, saveSettings } = useStore();
  const [tab, setTab] = useState<Tab>("general");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TABS;
    const words = q.split(/\s+/);
    return TABS.filter((t) => words.every((w) => `${t.label} ${t.keywords}`.toLowerCase().includes(w)));
  }, [query]);
  const active = visible.some((t) => t.id === tab) ? tab : (visible[0]?.id ?? tab);

  if (!settings) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const set = (patch: Partial<Settings>) => saveSettings(patch);
  const props: PaneProps = { settings, set, save: saveSettings };

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <nav aria-label="Settings sections" className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-border bg-bg px-2 py-4">
        <h2 className="px-2 pb-2 text-lg font-semibold">Settings</h2>
        <div className="relative mb-2">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input aria-label="Search settings" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} className="pl-7" />
        </div>
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={active === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={cx("flex h-8 w-full items-center gap-2.5 rounded px-2 text-left text-base", active === t.id ? "bg-surface-3 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text")}
          >
            <span className={active === t.id ? "text-accent-text" : "text-faint"}>{t.icon}</span>
            {t.label}
          </button>
        ))}
        {visible.length === 0 && <p className="px-2 py-1 text-sm text-faint">No settings match “{query}”.</p>}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-2xl px-8 pb-10">
          {active === "general" && <GeneralPane {...props} />}
          {active === "appearance" && <AppearancePane {...props} />}
          {active === "git" && <GitPane {...props} />}
          {active === "ai" && <AiPane settings={settings} save={saveSettings} />}
          {active === "claude" && <ClaudeCodePane {...props} />}
          {active === "updates" && <UpdatesPane />}
          {active === "about" && <AboutPane />}
        </div>
      </div>
    </div>
  );
}

function GeneralPane({ settings, set }: PaneProps) {
  const { repos, setPage } = useStore();
  return (
    <>
      <PaneHeader title="General" />
      <Group title="Startup">
        <Switch label="Reopen the last repository" checked={settings.reopenLastRepo} onChange={(reopenLastRepo) => void set({ reopenLastRepo })} />
      </Group>
      <Group title="Notifications">
        <Switch label="Show a notification when an operation succeeds" description="Errors are always shown." checked={settings.successNotifications} onChange={(successNotifications) => void set({ successNotifications })} />
      </Group>
      <Group title="Repositories">
        <div className="flex items-center justify-between gap-4">
          <p className="text-base text-muted">{repos.length} registered.</p>
          <Button size="sm" onClick={() => setPage("repositories")}>Manage repositories</Button>
        </div>
      </Group>
    </>
  );
}

function GitPane({ settings, set }: PaneProps) {
  const { info, refreshInfo, refreshStatus } = useStore();
  return (
    <>
      <PaneHeader title="Git" description="How GitPilot runs Git and what it checks before you commit." />
      <Group title="Git executable">
        {info?.gitError ? <ErrorNotice error={info.gitError} /> : info?.gitVersion ? <p className="text-base text-muted">Using Git {info.gitVersion} at <span className="selectable font-mono text-sm">{info.gitPath}</span></p> : null}
        <TextSetting
          label="Custom Git path"
          hint="Leave empty to find Git automatically (PATH, then common install locations)."
          value={settings.gitPath}
          mono
          browse="file"
          placeholder={info?.os === "windows" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git"}
          onSave={async (gitPath) => {
            const ok = await set({ gitPath });
            await refreshInfo();
            void refreshStatus();
            return ok;
          }}
        />
      </Group>
      <Group title="Identity" description="Read from your global Git configuration. Repositories can override it.">
        <p className="text-base">
          {info?.globalIdentity?.name || info?.globalIdentity?.email ? (
            <span className="selectable">{info?.globalIdentity?.name ?? "(no name)"} &lt;{info?.globalIdentity?.email ?? "no email"}&gt;</span>
          ) : (
            <span className="text-muted">No global identity is set. GitPilot will ask for one when you first commit.</span>
          )}
        </p>
      </Group>
      <Group title="Committing">
        <Field label="Commit message convention" hint="Conventional Commits prefixes like feat: and fix:. The composer hints at the format; it never blocks a commit.">
          {(p) => (
            <Select {...p} value={settings.commitConvention} onChange={(e) => void set({ commitConvention: e.target.value as Settings["commitConvention"] })}>
              <option value="none">None</option>
              <option value="conventional">Conventional Commits</option>
            </Select>
          )}
        </Field>
        <Switch
          label="Check line endings before committing"
          description={
            <>
              Warns when staged files use Windows line endings (CRLF) in a repository that uses LF, and converts them in one click. Otherwise GitHub shows every line as changed and pull request suggestions fail with “context doesn't match”.
            </>
          }
          checked={settings.checkLineEndings}
          onChange={(checkLineEndings) => void set({ checkLineEndings })}
        />
      </Group>
      <Group title="Pull" description="What Pull does when your branch and the remote both have new commits.">
        <Field label="Strategy">
          {(p) => (
            <Select {...p} value={settings.pullStrategy} onChange={(e) => void set({ pullStrategy: e.target.value as Settings["pullStrategy"] })}>
              <option value="ffOnly">Fast-forward only (safest; stops if branches diverged)</option>
              <option value="merge">Merge (creates a merge commit when needed)</option>
              <option value="rebase">Rebase (replays your commits on top)</option>
            </Select>
          )}
        </Field>
      </Group>
      <Group title="New repositories">
        <TextSetting label="Initial branch name" hint="Used when GitPilot creates a repository. Leave empty to use Git's default (init.defaultBranch)." value={settings.defaultBranch} placeholder="main" mono onSave={(defaultBranch) => set({ defaultBranch })} />
      </Group>
    </>
  );
}

function ClaudeCodePane({ settings, save }: PaneProps) {
  const { info } = useStore();
  const cc = settings.claudeCode;
  const det = useAsync(() => api.claudeDetect(), [cc.path, cc.terminal]);
  const setCc = (p: Partial<Settings["claudeCode"]>) => save((s) => ({ ...s, claudeCode: { ...s.claudeCode, ...p } }));
  return (
    <>
      <PaneHeader title="Claude Code" description="Open Claude Code in a repository from the Assistant, and use your Claude account for AI commit messages." />
      <Group title="Account">
        <ClaudeAccount />
      </Group>
      <Group title="Installation">
        {det.loading && !det.data ? (
          <Spinner />
        ) : det.data?.found ? (
          <p className="text-base">
            Found {det.data.version ? `Claude Code ${det.data.version}` : "Claude Code"} at <span className="selectable font-mono text-sm">{det.data.path}</span> <span className="text-muted">(from {det.data.source})</span>
          </p>
        ) : (
          <p className="text-base text-muted">Not found on PATH or in the usual install locations. Install Claude Code, or enter its path below.</p>
        )}
        <TextSetting label="Claude Code executable" hint="Leave empty to detect automatically." value={cc.path} mono browse="file" placeholder={info?.os === "windows" ? "%USERPROFILE%\\.local\\bin\\claude.exe" : "~/.local/bin/claude"} onSave={(path) => setCc({ path })} />
      </Group>
      {info?.os !== "windows" && (
        <Group title="Terminal" description="Claude Code is a terminal app, so GitPilot opens it (and its sign-in) in a terminal window.">
          <p className="text-base text-muted">{det.data?.terminal ? <>Using <span className="font-mono text-sm">{det.data.terminal}</span>.</> : "No terminal emulator found."}</p>
          <TextSetting label="Terminal emulator" hint="Leave empty to use $TERMINAL or the first known terminal found (GNOME Terminal, Konsole, kitty, Alacritty, xterm…)." value={cc.terminal} mono placeholder="gnome-terminal" onSave={(terminal) => setCc({ terminal })} />
        </Group>
      )}
      <Group title="Launching">
        <Switch label="Send the selected prompt when opening" description="Starts Claude Code with the Assistant's prompt as its first message." checked={cc.sendPromptOnLaunch} onChange={(sendPromptOnLaunch) => void setCc({ sendPromptOnLaunch })} />
      </Group>
    </>
  );
}

function UpdatesPane() {
  return (
    <>
      <PaneHeader title="Updates" description="GitPilot updates itself from GitHub Releases. Your repositories and settings are kept." />
      <Group title="Version">
        <UpdateSettings />
      </Group>
    </>
  );
}

function AboutPane() {
  const { info } = useStore();
  return (
    <>
      <PaneHeader title="About" />
      <Group title="GitPilot">
        <dl className="selectable grid grid-cols-[120px_1fr] gap-y-1 text-base">
          <dt className="text-muted">Version</dt><dd>{info?.version}</dd>
          <dt className="text-muted">Platform</dt><dd>{info?.os}</dd>
          <dt className="text-muted">Data folder</dt><dd className="truncate font-mono text-sm">{info?.dataDir}</dd>
        </dl>
        <p className="text-sm text-faint">Backups of discarded changes and line-ending conversions are kept in discard-backups inside the data folder.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void openUrl("https://olittechnologies.co.in/projects/git-pilot/")}>Website</Button>
          <Button size="sm" onClick={() => void openUrl("https://github.com/vinayakkam/gitpilot")}>Source on GitHub</Button>
          <Button size="sm" variant="ghost" onClick={() => void openUrl("https://github.com/vinayakkam/gitpilot/releases")}>Release notes</Button>
        </div>
        <p className="text-sm text-faint">Made by OLIT Technologies.</p>
      </Group>
    </>
  );
}
