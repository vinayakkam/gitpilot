import { DownloadCloud, FolderOpen, FolderPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { ErrorNotice } from "@/components/ui/Misc";
import { useStore } from "@/store/AppStore";
import { useRepoActions } from "./RepoActions";

function Action({ icon, title, desc, onClick, disabled }: { icon: ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start gap-3 border-b border-border px-1 py-3 text-left last:border-b-0 hover:bg-surface-2 disabled:opacity-50"
    >
      <span className="mt-0.5 text-muted group-hover:text-accent-text">{icon}</span>
      <span className="min-w-0">
        <span className="block text-md font-medium text-text">{title}</span>
        <span className="block text-base text-muted">{desc}</span>
      </span>
    </button>
  );
}

export function Welcome() {
  const { info } = useStore();
  const { addExisting, startClone, createNew } = useRepoActions();
  const gitMissing = info?.gitError?.kind === "gitNotFound";

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-surface px-8">
      <div className="w-full max-w-[460px] py-12">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <h1 className="text-xl font-semibold tracking-tight">GitPilot</h1>
        </div>
        <p className="mt-3 text-md text-muted">
          See exactly what changed, choose what goes into each commit, and keep branches and remotes in sync — with a
          clear explanation whenever Git pushes back.
        </p>

        {info?.gitError && <ErrorNotice className="mt-5" error={info.gitError} />}

        <div className="mt-6 border-t border-border">
          <Action
            icon={<FolderOpen size={18} />}
            title="Open a repository"
            desc="Choose a folder on this computer that already uses Git."
            onClick={() => void addExisting()}
            disabled={gitMissing}
          />
          <Action
            icon={<DownloadCloud size={18} />}
            title="Clone a repository"
            desc="Copy a repository from GitHub, GitLab, Bitbucket or your own server."
            onClick={startClone}
            disabled={gitMissing}
          />
          <Action
            icon={<FolderPlus size={18} />}
            title="Create a new repository"
            desc="Start tracking a folder with Git."
            onClick={() => void createNew()}
            disabled={gitMissing}
          />
        </div>

        {info?.gitVersion && (
          <p className="mt-6 text-sm text-faint">
            Using Git {info.gitVersion}
            {info.globalIdentity?.name ? ` as ${info.globalIdentity.name}` : ". No Git identity is set yet."}
          </p>
        )}
      </div>
    </div>
  );
}
