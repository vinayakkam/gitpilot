import { ExternalLink, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LFS_URL } from "@/features/overview/LfsCard";
import { api } from "@/lib/api";
import { openLink } from "@/lib/links";
import { useAsync } from "@/lib/useAsync";

/** Warns when the repository stores files with Git LFS but LFS isn't installed. */
export function LfsMissingNotice({ repoId }: { repoId: number }) {
  // Checked when the repository opens (and on "Check again"), not on every refresh.
  const lfs = useAsync(() => api.lfsStatus(repoId, false), [repoId]);
  const s = lfs.data;
  if (!s || s.installed || s.patterns.length === 0) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border bg-warning-bg px-3 py-1.5 text-sm text-text">
      <TriangleAlert size={14} className="shrink-0 text-warning" />
      <span className="flex-1">Some files in this repository are stored with Git LFS, which isn't installed. They appear as small pointer files, and committing them can break them for others.</span>
      <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => void openLink(LFS_URL)}>
        Get Git LFS
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void lfs.reload()}>
        Check again
      </Button>
    </div>
  );
}
