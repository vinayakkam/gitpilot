import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Input, Switch } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { ACCENT_PRESETS, accentHex, isHex } from "@/lib/accent";
import { Group, PaneHeader, Row, type PaneProps } from "./parts";

export function AppearancePane({ settings, set }: PaneProps) {
  return (
    <>
      <PaneHeader title="Appearance" description="How GitPilot looks. Changes apply immediately." />
      <Group title="Theme">
        <Segmented label="Theme" value={settings.theme} onChange={(theme) => void set({ theme })} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
      </Group>
      <Group title="Accent colour" description="Used for buttons, selection, links and focus rings.">
        <AccentPicker value={settings.accent} onChange={(accent) => void set({ accent })} />
      </Group>
      <Group title="Density" description="Row height in file, commit and branch lists.">
        <Segmented label="Density" value={settings.density} onChange={(density) => void set({ density })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Group>
      <Group title="Diffs">
        <Row label="Default layout">
          <Segmented label="Diff layout" value={settings.diffMode} onChange={(diffMode) => void set({ diffMode })} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Side by side" }]} />
        </Row>
        <Switch label="Syntax highlighting" description="Colors code in diffs for common languages." checked={settings.syntaxHighlighting} onChange={(syntaxHighlighting) => void set({ syntaxHighlighting })} />
      </Group>
    </>
  );
}

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = isHex(value);
  const [hex, setHex] = useState(accentHex(value));
  useEffect(() => setHex(accentHex(value)), [value]);
  const commitHex = (v: string) => {
    const h = v.startsWith("#") ? v : `#${v}`;
    if (isHex(h) && h.toLowerCase() !== value) onChange(h.toLowerCase());
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((p) => {
          const on = value === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.label}
              title={p.label}
              onClick={() => onChange(p.id)}
              className={cx("flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110", on ? "border-text" : "border-transparent")}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: p.hex }}>
                {on && <Check size={13} strokeWidth={3} className="text-white" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label className={cx("relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded border-2", custom ? "border-text" : "border-border-strong")} title="Pick a custom colour">
          <span className="absolute inset-0" style={{ background: hex }} />
          <input type="color" aria-label="Custom accent colour" value={hex} onChange={(e) => setHex(e.target.value)} onBlur={(e) => commitHex(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <div className="w-28">
          <Input aria-label="Accent colour hex value" value={hex} onChange={(e) => setHex(e.target.value.trim())} onBlur={() => commitHex(hex)} onKeyDown={(e) => e.key === "Enter" && commitHex(hex)} className="font-mono text-sm" maxLength={7} spellCheck={false} />
        </div>
        <Button size="sm" disabled={!isHex(hex.startsWith("#") ? hex : `#${hex}`) || hex.toLowerCase() === value} onClick={() => commitHex(hex)}>
          Use custom colour
        </Button>
        <span className="ml-auto text-sm text-muted">{custom ? "Custom" : ACCENT_PRESETS.find((p) => p.id === value)?.label}</span>
      </div>
      <AccentPreview />
    </div>
  );
}

/** A miniature of real UI elements so the effect of a colour is visible before leaving Settings. */
function AccentPreview() {
  return (
    <div aria-hidden className="flex items-center gap-3 rounded border border-border bg-bg p-3">
      <span className="flex h-6 items-center rounded bg-accent px-2.5 text-sm font-medium text-on-accent">Commit</span>
      <span className="flex h-6 items-center rounded bg-selection px-2 text-sm">Selected row</span>
      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-text">main</span>
      <span className="text-sm text-accent-text underline underline-offset-2">Link</span>
      <span className="ml-auto h-4 w-4 rounded-full border-2 border-focus" />
    </div>
  );
}
