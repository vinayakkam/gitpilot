import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AiText } from "@/bindings/AiText";
import type { AppError } from "@/bindings/AppError";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ReleaseNotes } from "@/components/ui/ReleaseNotes";
import { Spinner } from "@/components/ui/Spinner";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";
import { AiError, AiNote } from "./AiNote";

export interface ExplainRequest {
  title: string;
  load: () => Promise<AiText>;
}

/** Asks the AI to explain something and shows the answer. Open while `request` is set. */
export function ExplainDialog({ request, onClose }: { request: ExplainRequest | null; onClose: () => void }) {
  const { notify } = useStore();
  const [result, setResult] = useState<AiText | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const ask = async (r: ExplainRequest) => {
    const s = ++seq.current;
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const out = await r.load();
      if (s === seq.current) setResult(out);
    } catch (e) {
      if (s === seq.current) setError(toAppError(e));
    } finally {
      if (s === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (request) void ask(request);
    else seq.current++;
  }, [request]);

  return (
    <Dialog
      open={request !== null}
      onClose={onClose}
      width={620}
      title={request?.title ?? "Explanation"}
      footer={
        <>
          {result && (
            <Button icon={<Copy size={13} />} onClick={() => void writeText(result.text).then(() => notify({ tone: "success", title: "Explanation copied" }))}>
              Copy
            </Button>
          )}
          {(result || error) && request && (
            <Button icon={<RefreshCw size={13} />} onClick={() => void ask(request)}>
              Ask again
            </Button>
          )}
          <Button variant="primary" onClick={onClose} autoFocus>
            Close
          </Button>
        </>
      }
    >
      <div className="flex min-h-[120px] flex-col gap-3" aria-live="polite" aria-busy={loading}>
        {loading && (
          <p className="flex items-center gap-2 text-base text-muted">
            <Spinner size={12} /> Asking the AI…
          </p>
        )}
        {error && <AiError error={error} onSetUp={onClose} />}
        {result && (
          <>
            <ReleaseNotes source={result.text} className="selectable text-base leading-relaxed" />
            <AiNote model={result.model} excludedFiles={result.excludedFiles} truncated={result.truncated} />
          </>
        )}
      </div>
    </Dialog>
  );
}
