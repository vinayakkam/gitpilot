import { useMemo, useState, type ReactNode } from "react";
import { Bot, Check, ExternalLink, KeyRound, Search, ShieldCheck, Sparkles, Terminal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AiProviderKind } from "@/bindings/AiProviderKind";
import type { AppError } from "@/bindings/AppError";
import type { KeyStatus } from "@/bindings/KeyStatus";
import type { OpenRouterModel } from "@/bindings/OpenRouterModel";
import type { Settings } from "@/bindings/Settings";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/Field";
import { Badge, ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useAsync, useDebounced } from "@/lib/useAsync";
import { ClaudeAccount } from "./ClaudeAccount";
import { Group, PaneHeader, TextSetting, type Save } from "./parts";

export const DEFAULT_MODEL: Record<AiProviderKind, string> = {
  openRouter: "openrouter/auto",
  claudeCode: "haiku",
  anthropic: "claude-haiku-5-5",
  openAiCompatible: "",
};

const PROVIDERS: { id: AiProviderKind; title: string; blurb: string; icon: ReactNode; badge?: string }[] = [
  { id: "openRouter", title: "OpenRouter", blurb: "One key for hundreds of models from Anthropic, OpenAI, Google, Meta, Mistral and more, including free ones.", icon: <Sparkles size={16} />, badge: "Default" },
  { id: "claudeCode", title: "Claude Code", blurb: "Use the Claude account you're signed in to in Claude Code. No API key needed.", icon: <Terminal size={16} /> },
  { id: "anthropic", title: "Anthropic API", blurb: "Claude models with an Anthropic API key.", icon: <Bot size={16} /> },
  { id: "openAiCompatible", title: "OpenAI-compatible", blurb: "OpenAI, or a local server such as Ollama or LM Studio.", icon: <Bot size={16} /> },
];

export function AiPane({ settings, save }: { settings: Settings; save: Save }) {
  const ai = settings.ai;
  const provider = ai.provider;
  const setAi = (p: Partial<Settings["ai"]>) => save((s) => ({ ...s, ai: { ...s.ai, ...p } }));

  return (
    <>
      <PaneHeader title="AI" description="Suggests commit messages from your staged changes. Optional. Everything else in GitPilot works without it." />
      <Group title="AI commit messages">
        <div className="flex gap-3 rounded border border-border bg-surface-2 p-3 text-base">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-muted" />
          <div>
            <p>When you ask for a suggestion, the <strong>staged diff</strong> is sent to the provider you choose below. It may contain proprietary code. Unstaged files are never sent, and files that look like secrets (.env, keys, certificates) are left out.</p>
            <Checkbox className="mt-2" checked={ai.privacyAcknowledged} onChange={(v) => void setAi({ privacyAcknowledged: v, enabled: v ? ai.enabled : false })} label="I understand that staged changes are sent to an external service." />
          </div>
        </div>
        <Switch label="Enable AI suggestions" description={ai.privacyAcknowledged ? "The ✨ button in the commit box asks for suggestions." : "Accept the notice above first."} disabled={!ai.privacyAcknowledged} checked={ai.enabled} onChange={(enabled) => void setAi({ enabled })} />
      </Group>

      <Group title="Provider">
        <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => {
            const on = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && void setAi({ provider: p.id, model: DEFAULT_MODEL[p.id], baseUrl: "" })}
                className={cx("flex flex-col gap-1 rounded-md border p-3 text-left transition-colors", on ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-surface-2")}
              >
                <span className="flex items-center gap-2">
                  <span className={on ? "text-accent-text" : "text-muted"}>{p.icon}</span>
                  <span className="font-medium">{p.title}</span>
                  {p.badge && <Badge tone="accent">{p.badge}</Badge>}
                  {on && <Check size={14} className="ml-auto text-accent-text" />}
                </span>
                <span className="text-sm text-muted">{p.blurb}</span>
              </button>
            );
          })}
        </div>
      </Group>

      {provider === "openRouter" && <OpenRouterSettings settings={settings} setAi={setAi} />}
      {provider === "claudeCode" && <ClaudeCodeProvider settings={settings} setAi={setAi} />}
      {provider === "anthropic" && (
        <>
          <Group title="Model">
            <TextSetting label="Model" value={ai.model} mono placeholder="claude-haiku-5-5" hint="Any model id from the Claude API docs." onSave={(model) => setAi({ model })} />
          </Group>
          <ApiKey provider="anthropic" getKeyUrl="https://console.anthropic.com/settings/keys" />
        </>
      )}
      {provider === "openAiCompatible" && (
        <>
          <Group title="Server">
            <TextSetting label="Base URL" value={ai.baseUrl} mono placeholder="https://api.openai.com/v1" hint="For a local model, e.g. http://localhost:11434/v1 (Ollama). Requests go to <base URL>/chat/completions." onSave={(baseUrl) => setAi({ baseUrl })} />
            <TextSetting label="Model" value={ai.model} mono placeholder="gpt-4o-mini or llama3.1" hint="The model name your server expects." onSave={(model) => setAi({ model })} />
          </Group>
          <ApiKey provider="openAiCompatible" />
        </>
      )}

      <Group title="Suggestions">
        <Switch label="Include a description" description="Ask for a short body explaining why, in addition to the summary line." checked={ai.includeBody} onChange={(includeBody) => void setAi({ includeBody })} />
      </Group>
    </>
  );
}

type SetAi = (p: Partial<Settings["ai"]>) => Promise<boolean>;

function ApiKey({ provider, getKeyUrl, onChanged }: { provider: AiProviderKind; getKeyUrl?: string; onChanged?: () => void }) {
  const key = useAsync<KeyStatus>(() => api.secretStatus(provider), [provider]);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const store = async () => {
    setBusy(true);
    setError(null);
    try {
      key.setData(await api.secretSet(provider, newKey));
      setNewKey("");
      onChanged?.();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="API key" description="Stored in your system keychain, never in GitPilot's settings file.">
      {key.data && (
        <p className="flex items-center gap-2 text-base">
          <KeyRound size={14} className={key.data.stored || key.data.envVar ? "text-success" : "text-faint"} />
          {key.data.stored ? "A key is saved in the keychain." : key.data.envVar ? `Using the ${key.data.envVar} environment variable.` : provider === "openAiCompatible" ? "No key saved. Local servers often don't need one." : "No key saved yet."}
          {getKeyUrl && (
            <button type="button" onClick={() => void openUrl(getKeyUrl)} className="ml-auto flex items-center gap-1 text-sm text-accent-text hover:underline">
              Get a key <ExternalLink size={11} />
            </button>
          )}
        </p>
      )}
      {key.data && !key.data.keychainAvailable && (
        <ErrorNotice error={{ kind: "keychain", message: "The system keychain isn't available, so keys can't be saved here. Set the GITPILOT_AI_API_KEY environment variable before starting GitPilot instead.", detail: key.data.keychainError }} />
      )}
      <div className="flex gap-2">
        <Input type="password" aria-label="API key" autoComplete="off" placeholder={key.data?.stored ? "Enter a new key to replace it" : provider === "openRouter" ? "sk-or-v1-…" : "Paste API key"} value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newKey.trim() && void store()} className="font-mono text-sm" />
        <Button variant="primary" disabled={!newKey.trim()} loading={busy} onClick={store}>Save key</Button>
        {key.data?.stored && (
          <Button
            variant="danger-ghost"
            onClick={async () => {
              key.setData(await api.secretClear(provider));
              onChanged?.();
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {error && <ErrorNotice error={error} />}
    </Group>
  );
}

function money(n: number): string {
  return n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function OpenRouterSettings({ settings, setAi }: { settings: Settings; setAi: SetAi }) {
  const [keyRev, setKeyRev] = useState(0);
  const info = useAsync(() => api.openRouterKeyInfo(), [keyRev]);
  return (
    <>
      <ApiKey provider="openRouter" getKeyUrl="https://openrouter.ai/keys" onChanged={() => setKeyRev((r) => r + 1)} />
      {info.data && (
        <p className="-mt-3 mb-1 text-sm text-muted">
          Key verified{info.data.label ? ` (${info.data.label})` : ""}. Used {money(info.data.usage)}
          {info.data.limitRemaining != null ? `, ${money(info.data.limitRemaining)} left of ${money(info.data.limit ?? 0)} limit` : ""}
          {info.data.isFreeTier ? ". Free tier: free models only, with daily request limits." : "."}
        </p>
      )}
      {info.error && info.error.kind !== "aiNotConfigured" && <ErrorNotice compact className="-mt-2 mb-2" error={info.error} />}
      <Group title="Model" description="OpenRouter's Auto router picks a good model for each request. Or choose one yourself.">
        <OpenRouterModelPicker value={settings.ai.model} onChange={(model) => void setAi({ model })} />
      </Group>
    </>
  );
}

function OpenRouterModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const models = useAsync(() => api.openRouterModels(), []);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const q = useDebounced(query.trim().toLowerCase(), 120);

  const list = useMemo(() => {
    const all = models.data ?? [];
    return all
      .filter((m) => (!freeOnly || m.free) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.id === "openrouter/auto") - Number(a.id === "openrouter/auto"))
      .slice(0, 200);
  }, [models.data, q, freeOnly]);

  const current = models.data?.find((m) => m.id === value);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base">
        Using <span className="selectable font-mono text-sm">{value || "(none)"}</span>
        {current && current.name !== value && <span className="text-muted"> · {current.name}</span>}
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input aria-label="Search models" placeholder="Search models, e.g. claude, gpt, llama, free" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-7" />
        </div>
        <Checkbox checked={freeOnly} onChange={setFreeOnly} label="Free only" />
      </div>
      <div className="h-64 overflow-y-auto rounded border border-border" role="listbox" aria-label="OpenRouter models">
        {models.loading && !models.data ? (
          <div className="flex h-full items-center justify-center"><Spinner label="Loading models from OpenRouter" /></div>
        ) : models.error ? (
          <div className="p-2">
            <ErrorNotice compact error={models.error} />
            <Button size="sm" className="mt-2" onClick={() => void models.reload()}>Try again</Button>
          </div>
        ) : list.length === 0 ? (
          <p className="p-3 text-base text-muted">No models match.</p>
        ) : (
          list.map((m) => <ModelRow key={m.id} m={m} selected={m.id === value} onPick={() => onChange(m.id)} />)
        )}
      </div>
      <TextSetting label="Or enter a model id" value={value} mono placeholder="provider/model-name" onSave={async (id) => { onChange(id.trim()); return true; }} />
    </div>
  );
}

function price(m: OpenRouterModel): string {
  if (m.free) return "Free";
  if (m.promptPerMillion == null || m.completionPerMillion == null) return "Varies";
  const f = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/\.00$/, "") : n.toFixed(3).replace(/0+$/, ""));
  return `$${f(m.promptPerMillion)} / $${f(m.completionPerMillion)}`;
}

function ModelRow({ m, selected, onPick }: { m: OpenRouterModel; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onPick} className={cx("flex w-full items-center gap-3 border-b border-border px-3 py-1.5 text-left last:border-b-0", selected ? "bg-selection" : "hover:bg-surface-2")}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base">{m.id === "openrouter/auto" ? "Auto (OpenRouter picks)" : m.name}</span>
        <span className="block truncate font-mono text-xs text-faint">{m.id}</span>
      </span>
      {m.contextLength != null && <span className="shrink-0 text-xs text-faint">{m.contextLength >= 1000 ? `${Math.round(m.contextLength / 1000)}K` : m.contextLength} ctx</span>}
      <span className={cx("w-28 shrink-0 text-right text-xs tabular-nums", m.free ? "text-success" : "text-muted")} title="Price per million input / output tokens">
        {price(m)}
      </span>
      {selected && <Check size={14} className="shrink-0 text-accent-text" />}
    </button>
  );
}

const CLAUDE_MODELS = [
  { value: "haiku", label: "Haiku (fastest, lightest on your limits)" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "", label: "Claude Code's default model" },
];

function ClaudeCodeProvider({ settings, setAi }: { settings: Settings; setAi: SetAi }) {
  return (
    <Group title="Claude account" description="Commit messages are written by Claude Code running in the background, signed in with your Claude account.">
      <ClaudeAccount compact />
      <Field label="Model" hint="Uses your plan's usage. Haiku is plenty for commit messages.">
        {(p) => (
          <Select {...p} value={settings.ai.model} onChange={(e) => void setAi({ model: e.target.value })}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            {!CLAUDE_MODELS.some((m) => m.value === settings.ai.model) && <option value={settings.ai.model}>{settings.ai.model}</option>}
          </Select>
        )}
      </Field>
    </Group>
  );
}
