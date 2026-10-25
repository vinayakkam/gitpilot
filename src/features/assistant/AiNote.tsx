import { Settings2 } from "lucide-react";
import type { AppError } from "@/bindings/AppError";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/Misc";
import { useStore } from "@/store/AppStore";

/** Which model wrote something, what was left out, and a reminder to check it. */
export function AiNote({ model, excludedFiles, truncated }: { model: string; excludedFiles: string[]; truncated: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm text-faint">
      <p>Written by {model || "AI"}. AI can be wrong, so check it before relying on it.</p>
      {excludedFiles.length > 0 && <p>Not sent because they may contain secrets: {excludedFiles.join(", ")}</p>}
      {truncated && <p>The changes were too long to send in full, so only the first part was used.</p>}
    </div>
  );
}

/** An AI error, with a way into Settings → AI when AI isn't set up yet. */
export function AiError({ error, onSetUp }: { error: AppError; onSetUp?: () => void }) {
  const { openSettings } = useStore();
  return (
    <div className="flex flex-col gap-2">
      <ErrorNotice error={error} />
      {error.kind === "aiNotConfigured" && (
        <div>
          <Button
            size="sm"
            icon={<Settings2 size={12} />}
            onClick={() => {
              onSetUp?.();
              openSettings("ai");
            }}
          >
            Set up AI
          </Button>
        </div>
      )}
    </div>
  );
}
