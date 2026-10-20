import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { Checkbox } from "./Field";
import { IconButton } from "./IconButton";
import { cx } from "./cx";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Prevents closing with Escape/backdrop while an operation runs. */
  busy?: boolean;
  onSubmit?: () => void;
}

/** Modal built on the native <dialog> element: focus trapping and Escape handling come for free. */
export function Dialog({ open, onClose, title, description, children, footer, width = 440, busy, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit?.();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      className="gp-pop m-auto max-h-[85vh] overflow-visible rounded-md border border-border bg-surface p-0 text-text shadow-overlay"
      style={{ width: `min(${width}px, calc(100vw - 48px))` }}
    >
      {open && (
        <form onSubmit={submit} className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 px-5 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-md font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-base text-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton label="Close" icon={<X size={15} />} size="sm" onClick={onClose} disabled={busy} className="-mr-2 -mt-0.5" />
          </header>
          {children && <div className="min-h-0 overflow-auto px-5 pt-4">{children}</div>}
          <footer className="flex items-center justify-end gap-2 px-5 pb-4 pt-5">{footer}</footer>
        </form>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Requires ticking a checkbox with this text before confirming. */
  acknowledge?: string;
  onConfirm: () => Promise<unknown> | void;
}

export function ConfirmDialog({ open, onClose, title, children, confirmLabel, danger, acknowledge, onConfirm }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (open) setAck(false);
  }, [open]);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Caller reports the error; keep the dialog open so the user can retry or cancel.
    } finally {
      setBusy(false);
    }
  };
  const blocked = Boolean(acknowledge) && !ack;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      onSubmit={() => !blocked && run()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={blocked} autoFocus={!danger}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={cx("text-base text-muted", !children && "hidden")}>{children}</div>
      {acknowledge && <Checkbox className="mt-3 text-text" checked={ack} onChange={setAck} label={acknowledge} />}
    </Dialog>
  );
}
