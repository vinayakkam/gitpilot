import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings } from "@/bindings/Settings";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import type { useStore } from "@/store/AppStore";

export type Save = ReturnType<typeof useStore>["saveSettings"];
export type PaneProps = { settings: Settings; set: (p: Partial<Settings>) => Promise<boolean>; save: Save };

export function PaneHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="pb-1 pt-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && <p className="mt-1 text-base text-muted">{description}</p>}
    </header>
  );
}

export function Group({ title, children, description, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="border-b border-border py-5 last:border-b-0">
      <h3 className="text-md font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-base text-muted">{description}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Text setting saved on blur/Enter, so typing doesn't write the file on every keystroke. */
export function TextSetting({ label, hint, value, onSave, placeholder, mono, browse }: { label: string; hint?: ReactNode; value: string; onSave: (v: string) => Promise<boolean>; placeholder?: string; mono?: boolean; browse?: "file" }) {
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

/** A label on the left, a control on the right. */
export function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <div className="text-base">{label}</div>
        {description && <div className="text-sm text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
