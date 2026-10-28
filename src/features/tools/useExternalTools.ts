import { useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

/** Opens the active repository (or one of its files) in the editor, or a terminal there. */
export function useExternalTools() {
  const { activeRepo, notify } = useStore();
  const id = activeRepo?.id;
  const editor = useCallback(
    (path: string | null = null, line: number | null = null) => {
      if (id == null) return;
      api.editorOpen(id, path, line).catch((e) => notify({ tone: "error", title: "Couldn't open the editor", error: toAppError(e) }));
    },
    [id, notify],
  );
  const terminal = useCallback(() => {
    if (id == null) return;
    api.terminalOpen(id).catch((e) => notify({ tone: "error", title: "Couldn't open a terminal", error: toAppError(e) }));
  }, [id, notify]);
  return useMemo(() => ({ editor, terminal }), [editor, terminal]);
}
