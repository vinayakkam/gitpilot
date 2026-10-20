import type { ChangeType } from "@/bindings/ChangeType";
import { cx } from "./cx";

const MAP: Record<ChangeType, { letter: string; label: string; cls: string }> = {
  added: { letter: "A", label: "Added", cls: "text-added border-added/40" },
  untracked: { letter: "U", label: "Untracked (new file)", cls: "text-added border-added/40 border-dashed" },
  modified: { letter: "M", label: "Modified", cls: "text-modified border-modified/40" },
  deleted: { letter: "D", label: "Deleted", cls: "text-removed border-removed/40" },
  renamed: { letter: "R", label: "Renamed", cls: "text-renamed border-renamed/40" },
  copied: { letter: "C", label: "Copied", cls: "text-renamed border-renamed/40" },
  typeChanged: { letter: "T", label: "Type changed", cls: "text-modified border-modified/40" },
  conflicted: { letter: "!", label: "Conflicted", cls: "text-conflict border-conflict/50 bg-conflict-bg" },
};

export function changeLabel(c: ChangeType): string {
  return MAP[c].label;
}

/** Letter + color + border style, so status never depends on color alone. */
export function StatusGlyph({ change, className }: { change: ChangeType; className?: string }) {
  const m = MAP[change];
  return (
    <span
      title={m.label}
      aria-label={m.label}
      className={cx(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] font-medium leading-none",
        m.cls,
        className,
      )}
    >
      {m.letter}
    </span>
  );
}
