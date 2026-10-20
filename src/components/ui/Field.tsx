import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const control =
  "w-full rounded border border-border-strong bg-surface px-2 text-base text-text placeholder:text-faint " +
  "transition-colors hover:border-faint focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} spellCheck={false} className={cx(control, "h-7", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(control, "resize-none py-1.5 leading-5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(control, "h-7 pr-6", className)} {...rest}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
}

/** Label + control + hint/error, with ids wired for accessibility. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? descId : undefined })}
      {(error || hint) && (
        <p id={descId} className={cx("text-sm", error ? "text-danger" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <label htmlFor={id} className="text-base text-text">
          {label}
        </label>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span
          className={cx(
            "absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[16px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex items-start gap-2 text-base", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  );
}
