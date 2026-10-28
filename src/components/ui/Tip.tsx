import type { ReactNode } from "react";
import { Lightbulb, X } from "lucide-react";
import { useStore } from "@/store/AppStore";
import { cx } from "./cx";

/** Moments that get a one-time explanation. */
export type TipId = "stage" | "commit" | "publish" | "conflict" | "detached" | "pullRequest";

/** Whether a tip should show: tips are on and this one wasn't closed. */
export function useTip(id: TipId): { show: boolean; dismiss: () => void } {
  const { settings, saveSettings } = useStore();
  const show = !!settings?.tips && !settings.dismissedTips.includes(id);
  const dismiss = () => {
    if (settings) void saveSettings({ dismissedTips: [...settings.dismissedTips, id] });
  };
  return { show, dismiss };
}

/** A short beginner's explanation, shown once until closed (Settings → General turns them off). */
export function Tip({ id, title, children, className }: { id: TipId; title: string; children: ReactNode; className?: string }) {
  const { show, dismiss } = useTip(id);
  if (!show) return null;
  return (
    <aside aria-label={`Tip: ${title}`} className={cx("flex items-start gap-2 rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm", className)}>
      <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-accent-text">{title}</p>
        <p className="mt-0.5 text-text">{children}</p>
      </div>
      <button type="button" aria-label="Got it, hide this tip" onClick={dismiss} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-text">
        <X size={13} />
      </button>
    </aside>
  );
}
