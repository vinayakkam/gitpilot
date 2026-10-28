import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { ErrorNotice } from "@/components/ui/Misc";
import { useStore } from "@/store/AppStore";

export function Toaster() {
  const { toasts, dismiss, busy } = useStore();
  return (
    <>
      {/* Screen readers hear when an operation starts; its result arrives as a notification. */}
      <div role="status" aria-live="polite" className="sr-only">
        {busy ? `${busy}…` : ""}
      </div>
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[95] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="gp-pop pointer-events-auto rounded-md border border-border bg-surface p-3 shadow-overlay">
            <div className="flex items-start gap-2">
              {t.tone === "success" && <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" />}
              {t.tone === "error" && <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />}
              {t.tone === "info" && <Info size={16} className="mt-0.5 shrink-0 text-accent-text" />}
              <div className="min-w-0 flex-1">
                <p className={cx("text-base font-medium", t.tone === "error" && "text-danger")}>{t.title}</p>
                {t.body && <p className="selectable mt-0.5 break-words text-sm text-muted">{t.body}</p>}
              </div>
              <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-text">
                <X size={14} />
              </button>
            </div>
            {t.error && <ErrorNotice compact className="mt-2" error={t.error} />}
            {t.action && (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    dismiss(t.id);
                    t.action?.run();
                  }}
                >
                  {t.action.label}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
