import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import type { KeyStatus } from "@/bindings/KeyStatus";
import type { Settings } from "@/bindings/Settings";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { open } from "@tauri-apps/plugin-dialog";

type Tab = "appearance" | "git" | "ai" | "claude" | "general";
const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "git", label: "Git" },
  { id: "ai", label: "AI" },
  { id: "claude", label: "Claude Code" },
  { id: "general", label: "General" },
];

function Group({ title, children, description }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border py-5 last:border-b-0">
      <h3 className="text-md font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-base text-muted">{description}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Text setting saved on blur/Enter, so typing doesn't write the file on every keystroke. */
function TextSetting({ label, hint, value, onSave, placeholder, mono, browse }: { label: string; hint?: ReactNode; value: string; onSave: (v: string) => Promise<boolean>; placeholder?: string; mono?: boolean; browse?: "file" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (next = v) => {
    if (next !== value) void onSave(next);
  };
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <div className="flex gap-2">
          <Input {...p} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={(e) => e.key === "Enter" && commit()} className={mono ? "font-mono text-sm" : undefined} />
          {browse && (
            <Button
              onClick={async () => {
                const f = await open({ multiple: false, directory: false, title: `Choose ${label.toLowerCase()}` });
                if (typeof f === "string") {
                  setV(f);
                  commit(f);
                }
              }}
            >
              Browse…
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

export function SettingsView() {
  const { settings, saveSettings } = useStore();
  const [tab, setTab] = useState<Tab>("appearance");
  if (!settings) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const set = (patch: Partial<Settings>) => saveSettings(patch);

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <nav aria-label="Settings sections" className="w-[200px] shrink-0 border-r border-border px-2 py-4">
        <h2 className="px-2 pb-2 text-lg font-semibold">Settings</h2>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={cx("flex h-8 w-full items-center rounded px-2 text-left text-base", tab === t.id ? "bg-surface-3 font-medium" : "text-muted hover:bg-surface-2 hover:text-text")}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-2xl px-8 py-2">
          {tab === "appearance" && <Appearance settings={settings} set={set} />}
          {tab === "git" && <GitSettings settings={settings} set={set} />}
          {tab === "ai" && <AiSettingsPane settings={settings} save={saveSettings} />}
          {tab === "claude" && <ClaudeSettings settings={settings} save={saveSettings} />}
          {tab === "general" && <General settings={settings} set={set} />}
        </div>
      </div>
    </div>
  );
}

type PaneProps = { settings: Settings; set: (p: Partial<Settings>) => Promise<boolean> };

function Appearance({ settings, set }: PaneProps) {
  return (
    <>
      <Group title="Theme">
        <Segmented label="Theme" value={settings.theme} onChange={(theme) => void set({ theme })} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
      </Group>
      <Group title="Density" description="Row height in file, commit and branch lists.">
        <Segmented label="Density" value={settings.density} onChange={(density) => void set({ density })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Group>
      <Group title="Diffs">
        <div className="flex items-center justify-between">
          <span className="text-base">Default layout</span>
          <Segmented label="Diff layout" value={settings.diffMode} onChange={(diffMode) => void set({ diffMode })} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Side by side" }]} />
        </div>
        <Switch label="Syntax highlighting" description="Colors code in diffs for common languages." checked={settings.syntaxHighlighting} onChange={(syntaxHighlighting) => void set({ syntaxHighlighting })} />
      </Group>
    </>
  );
}

function GitSettings({ settings, set }: PaneProps) {
  const { info, refreshInfo, refreshStatus } = useStore();
  return (
    <>
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
      <Group title="New repositories">
        <TextSetting label="Initial branch name" hint="Used when GitPilot creates a repository. Leave empty to use Git's default (init.defaultBranch)." value={settings.defaultBranch} placeholder="main" mono onSave={(defaultBranch) => set({ defaultBranch })} />
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
      <Group title="Commit messages">
        <Field label="Convention" hint="Conventional Commits prefixes like feat: and fix:. The composer hints at the format; it never blocks a commit.">
          {(p) => (
            <Select {...p} value={settings.commitConvention} onChange={(e) => void set({ commitConvention: e.target.value as Settings["commitConvention"] })}>
              <option value="none">None</option>
              <option value="conventional">Conventional Commits</option>
            </Select>
          )}
        </Field>
      </Group>
    </>
  );
}

function AiSettingsPane({ settings, save }: { settings: Settings; save: ReturnType<typeof useStore>["saveSettings"] }) {
  const ai = settings.ai;
  const provider = ai.provider;
  const key = useAsync<KeyStatus>(() => api.secretStatus(provider), [provider]);
  const [newKey, setNewKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<AppError | null>(null);
  const setAi = (p: Partial<Settings["ai"]>) => save((s) => ({ ...s, ai: { ...s.ai, ...p } }));

  const storeKey = async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      key.setData(await api.secretSet(provider, newKey));
      setNewKey("");
    } catch (e) {
      setKeyError(toAppError(e));
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <>
      <Group title="AI commit messages" description="Suggests commit messages from your staged changes. Optional. Everything else in GitPilot works without it.">
        <div className="flex gap-3 rounded border border-border bg-surface-2 p-3 text-base">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted" />
          <div>
            <p>When you ask for a suggestion, the <strong>staged diff</strong> is sent to the provider below. It may contain proprietary code. Unstaged files are never sent, and files that look like secrets (.env, keys, certificates) are left out.</p>
            <Checkbox className="mt-2" checked={ai.privacyAcknowledged} onChange={(v) => void setAi({ privacyAcknowledged: v, enabled: v ? ai.enabled : false })} label="I understand that staged changes are sent to an external service." />
          </div>
        </div>
        <Switch label="Enable AI suggestions" disabled={!ai.privacyAcknowledged} checked={ai.enabled} onChange={(enabled) => void setAi({ enabled })} />
      </Group>
      <Group title="Provider">
        <Field label="Provider">
          {(p) => (
            <Select {...p} value={provider} onChange={(e) => void setAi({ provider: e.target.value as Settings["ai"]["provider"], model: e.target.value === "anthropic" ? "claude-haiku-5-5" : "", baseUrl: e.target.value === "anthropic" ? "" : ai.baseUrl })}>
              <option value="anthropic">Anthropic (Claude API)</option>
              <option value="openAiCompatible">OpenAI-compatible API (OpenAI, Ollama, LM Studio…)</option>
            </Select>
          )}
        </Field>
        <TextSetting label="Model" value={ai.model} mono placeholder={provider === "anthropic" ? "claude-haiku-5-5" : "gpt-4o-mini or llama3.1"} hint={provider === "anthropic" ? "Any model id from the Claude API docs." : "The model name your server expects."} onSave={(model) => setAi({ model })} />
        {provider === "openAiCompatible" && (
          <TextSetting label="Base URL" value={ai.baseUrl} mono placeholder="https://api.openai.com/v1" hint="For a local model, e.g. http://localhost:11434/v1 (Ollama). Requests go to <base URL>/chat/completions." onSave={(baseUrl) => setAi({ baseUrl })} />
        )}
        <Switch label="Include a description" description="Ask for a short body explaining why, in addition to the summary line." checked={ai.includeBody} onChange={(includeBody) => void setAi({ includeBody })} />
      </Group>
      <Group title="API key" description="Stored in your system keychain, never in GitPilot's settings file.">
        {key.data && (
          <p className="text-base">
            {key.data.stored ? "A key is saved in the keychain." : key.data.envVar ? `Using the ${key.data.envVar} environment variable.` : provider === "openAiCompatible" ? "No key saved. Local servers often don't need one." : "No key saved."}
          </p>
        )}
        {key.data && !key.data.keychainAvailable && (
          <ErrorNotice error={{ kind: "keychain", message: "The system keychain isn't available, so keys can't be saved here. Set the GITPILOT_AI_API_KEY environment variable before starting GitPilot instead.", detail: key.data.keychainError }} />
        )}
        <div className="flex gap-2">
          <Input type="password" aria-label="API key" autoComplete="off" placeholder={key.data?.stored ? "Enter a new key to replace it" : "Paste API key"} value={newKey} onChange={(e) => setNewKey(e.target.value)} className="font-mono text-sm" />
          <Button variant="primary" disabled={!newKey.trim()} loading={keyBusy} onClick={storeKey}>Save key</Button>
          {key.data?.stored && (
            <Button variant="danger-ghost" onClick={async () => key.setData(await api.secretClear(provider))}>Remove</Button>
          )}
        </div>
        {keyError && <ErrorNotice error={keyError} />}
      </Group>
    </>
  );
}

function ClaudeSettings({ settings, save }: { settings: Settings; save: ReturnType<typeof useStore>["saveSettings"] }) {
  const { info } = useStore();
  const cc = settings.claudeCode;
  const det = useAsync(() => api.claudeDetect(), [cc.path, cc.terminal]);
  const setCc = (p: Partial<Settings["claudeCode"]>) => save((s) => ({ ...s, claudeCode: { ...s.claudeCode, ...p } }));
  return (
    <>
      <Group title="Detection">
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
        <Group title="Terminal" description="Claude Code is a terminal app, so GitPilot opens it in a terminal window.">
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

function General({ settings, set }: PaneProps) {
  const { info, repos } = useStore();
  return (
    <>
      <Group title="Startup">
        <Switch label="Reopen the last repository" checked={settings.reopenLastRepo} onChange={(reopenLastRepo) => void set({ reopenLastRepo })} />
      </Group>
      <Group title="Notifications">
        <Switch label="Show a notification when an operation succeeds" description="Errors are always shown." checked={settings.successNotifications} onChange={(successNotifications) => void set({ successNotifications })} />
      </Group>
      <Group title="Repositories">
        <p className="text-base text-muted">{repos.length} registered. Manage them from Repositories in the sidebar.</p>
      </Group>
      <Group title="About">
        <dl className="selectable grid grid-cols-[120px_1fr] gap-y-1 text-base">
          <dt className="text-muted">GitPilot</dt><dd>{info?.version}</dd>
          <dt className="text-muted">Platform</dt><dd>{info?.os}</dd>
          <dt className="text-muted">Data folder</dt><dd className="truncate font-mono text-sm">{info?.dataDir}</dd>
        </dl>
        <p className="text-sm text-faint">Backups of discarded changes are kept in discard-backups inside the data folder.</p>
      </Group>
    </>
  );
}
