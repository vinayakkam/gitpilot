import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  icon: ReactNode;
  shortcut?: string;
  size?: "sm" | "md";
  loading?: boolean;
  active?: boolean;
  tone?: "default" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, size = "md", loading, active, tone = "default", className, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <Tooltip content={shortcut ? `${label}  ${shortcut}` : label}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled || loading}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded transition-colors duration-100",
          "disabled:pointer-events-none disabled:opacity-40",
          size === "sm" ? "h-6 w-6" : "h-7 w-7",
          tone === "danger" ? "text-muted hover:bg-removed-bg hover:text-danger" : "text-muted hover:bg-surface-3 hover:text-text",
          active && "bg-surface-3 text-text",
          className,
        )}
        {...rest}
      >
        {loading ? <Spinner size={12} /> : icon}
      </button>
    </Tooltip>
  );
});
