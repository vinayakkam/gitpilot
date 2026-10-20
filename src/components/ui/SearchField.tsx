import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { cx } from "./cx";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (v: string) => void;
  label: string;
}

export const SearchField = forwardRef<HTMLInputElement, Props>(function SearchField({ value, onChange, label, className, ...rest }, ref) {
  return (
    <div className={cx("relative flex items-center", className)}>
      <Search size={13} className="pointer-events-none absolute left-2 text-faint" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        className="h-7 w-full rounded border border-border bg-surface-2 pl-7 pr-7 text-base text-text placeholder:text-faint focus:border-accent focus:bg-surface focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-1.5 rounded p-0.5 text-faint hover:text-text">
          <X size={12} />
        </button>
      )}
    </div>
  );
});
