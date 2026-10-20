import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import { cx } from "./cx";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border-strong bg-surface-2 px-1 font-mono text-xs text-muted">
      {children}
    </kbd>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "warning" | "danger" | "success"; title?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-muted",
    accent: "bg-accent-soft text-accent-text",
    warning: "bg-warning-bg text-warning",
    danger: "bg-removed-bg text-danger",
    success: "bg-added-bg text-success",
  };
  return (
    <span title={title} className={cx("inline-flex h-[18px] items-center rounded-sm px-1.5 text-xs font-medium tabular-nums", tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex h-full flex-col items-center justify-center px-8 py-10 text-center", className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-md font-medium text-text">{title}</p>
      {children && <div className="mt-1 max-w-sm text-base text-muted">{children}</div>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Plain-language error with an expandable technical-details section. */
export function ErrorNotice({ error, className, compact }: { error: AppError; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className={cx("rounded border border-danger/30 bg-removed-bg text-text", compact ? "px-2.5 py-2" : "px-3 py-2.5", className)}>
      <p className="selectable text-base">{error.message}</p>
      {error.detail && (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-sm text-muted hover:text-text"
          >
            <ChevronRight size={12} className={cx("transition-transform", open && "rotate-90")} />
            Technical details
          </button>
          {open && (
            <pre className="selectable mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface/60 p-2 font-mono text-xs text-muted">
              {error.detail}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

export function SectionHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-muted">{children}</h3>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
