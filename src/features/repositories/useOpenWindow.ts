import { useCallback } from "react";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useStore } from "@/store/AppStore";

/** Opens a registered repository (by id) or a folder (registered first) in its own window. */
export function useOpenWindow() {
  const { refreshRepos, notify } = useStore();
  return useCallback(
    async (target: { id: number } | { path: string }) => {
      try {
        let id: number;
        if ("id" in target) id = target.id;
        else {
          id = (await api.repoAdd(target.path)).id;
          await refreshRepos();
        }
        await api.windowOpenRepo(id);
      } catch (e) {
        notify({ tone: "error", title: "Couldn't open a new window", error: toAppError(e) });
      }
    },
    [refreshRepos, notify],
  );
}
