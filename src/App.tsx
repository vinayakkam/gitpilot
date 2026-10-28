import { useEffect } from "react";
import { FolderSearch, Trash2 } from "lucide-react";
import { RepoToolbar } from "@/components/layout/RepoToolbar";
import { SECTIONS, Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "@/components/layout/Toaster";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { AssistantView } from "@/features/assistant/AssistantView";
import { BranchesView } from "@/features/branches/BranchesView";
import { ChangesView } from "@/features/changes/ChangesView";
import { HistoryView } from "@/features/history/HistoryView";
import { RepoActionsProvider, useRepoActions } from "@/features/onboarding/RepoActions";
import { Welcome } from "@/features/onboarding/Welcome";
import { OverviewView } from "@/features/overview/OverviewView";
import { PullRequestsView } from "@/features/github/PullRequestsView";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { RemotesView } from "@/features/remotes/RemotesView";
import { RepositoriesView } from "@/features/repositories/RepositoriesView";
import { SettingsView } from "@/features/settings/SettingsView";
import { hasMod } from "@/lib/platform";
import { AppStoreProvider, useStore } from "@/store/AppStore";
import { UpdateDialog } from "@/features/updates/UpdateDialog";
import { UpdateProvider } from "@/features/updates/UpdateProvider";
import { TitleTooltips } from "@/components/ui/TitleTooltips";
import { api } from "@/lib/api";

function MissingRepo() {
  const { activeRepo, statusError, refreshRepos, refreshStatus, setPage, notify } = useStore();
  const { relocate } = useRepoActions();
  if (!activeRepo || !statusError) return null;
  return (
    <EmptyState
      title={statusError.kind === "pathNotFound" ? `${activeRepo.name} can't be found` : `${activeRepo.name} can't be read`}
      action={
        <>
          <Button icon={<FolderSearch size={14} />} onClick={() => void relocate(activeRepo).then(refreshStatus)}>Locate folder…</Button>
          <Button
            variant="danger-ghost"
            icon={<Trash2 size={14} />}
            onClick={async () => {
              await api.repoRemove(activeRepo.id);
              await refreshRepos();
              setPage("repositories");
              notify({ tone: "success", title: `Removed ${activeRepo.name} from GitPilot` });
            }}
          >
            Remove from GitPilot
          </Button>
        </>
      }
    >
      <ErrorNotice className="mt-2 text-left" error={statusError} />
    </EmptyState>
  );
}

function RepoWorkspace() {
  const { section, statusError } = useStore();
  const blocking = statusError && (statusError.kind === "pathNotFound" || statusError.kind === "notARepository");
  if (blocking) return <MissingRepo />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RepoToolbar />
      <main className="min-h-0 flex-1" aria-label={SECTIONS.find((s) => s.id === section)?.label}>
        {section === "overview" && <OverviewView />}
        {section === "changes" && <ChangesView />}
        {section === "history" && <HistoryView />}
        {section === "branches" && <BranchesView />}
        {section === "remotes" && <RemotesView />}
        {section === "assistant" && <AssistantView />}
        {section === "pulls" && <PullRequestsView />}
      </main>
    </div>
  );
}

function Shell() {
  const { settings, page, activeRepo, repos, setPage, setSection, setPaletteOpen, refreshStatus, paletteOpen } = useStore();

  // Global keyboard shortcuts. Browser shortcuts that don't make sense in a desktop app are suppressed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = hasMod(e);
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setPage("settings");
      } else if (mod && !e.shiftKey && /^[1-7]$/.test(e.key) && activeRepo) {
        e.preventDefault();
        const s = SECTIONS[Number(e.key) - 1];
        if (s) setSection(s.id);
      } else if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        void refreshStatus();
      } else if (mod && ["p", "s", "u", "f", "g"].includes(e.key.toLowerCase()) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); // print, save page, view source, find…
      }
    };
    const onContext = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, .selectable")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
  }, [activeRepo, paletteOpen, refreshStatus, setPage, setPaletteOpen, setSection]);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <Spinner label="Starting GitPilot" />
      </div>
    );
  }

  const firstRun = repos.length === 0 && page === "repo";
  return (
    <div className="flex h-full">
      {!firstRun && <Sidebar />}
      <div className="min-w-0 flex-1">
        {firstRun ? (
          <Welcome />
        ) : page === "settings" ? (
          <SettingsView />
        ) : page === "repositories" || !activeRepo ? (
          <RepositoriesView />
        ) : (
          <RepoWorkspace />
        )}
      </div>
      <CommandPalette />
      <UpdateDialog />
      <Toaster />
      <TitleTooltips />
    </div>
  );
}

export default function App() {
  return (
    <AppStoreProvider>
      <RepoActionsProvider>
        <UpdateProvider>
          <Shell />
        </UpdateProvider>
      </RepoActionsProvider>
    </AppStoreProvider>
  );
}
