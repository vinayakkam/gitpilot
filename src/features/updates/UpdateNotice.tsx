import { ArrowUpCircle } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUpdates } from "./UpdateProvider";

/** Sidebar notice shown when a newer version is ready. */
export function UpdateNotice({ collapsed }: { collapsed: boolean }) {
  const { phase, setDialogOpen } = useUpdates();
  const update =
    phase.kind === "available" || phase.kind === "downloading" || phase.kind === "installing" || phase.kind === "restartPending" ? phase.update : null;
  if (!update) return null;
  const label = phase.kind === "restartPending" ? "Restart to update" : `Update to ${update.version}`;
  const btn = (
    <button
      type="button"
      onClick={() => setDialogOpen(true)}
      aria-label={label}
      className={cx(
        "flex h-[30px] w-full items-center gap-2.5 rounded bg-accent-soft px-2 text-base font-medium text-accent-text hover:bg-selection",
        collapsed && "justify-center px-0",
      )}
    >
      <ArrowUpCircle size={16} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  return collapsed ? <Tooltip content={label}>{btn}</Tooltip> : btn;
}
