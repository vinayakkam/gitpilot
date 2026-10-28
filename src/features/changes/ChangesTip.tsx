import type { RepoStatus } from "@/bindings/RepoStatus";
import { Tip, type TipId } from "@/components/ui/Tip";
import { useStore } from "@/store/AppStore";

const TIPS: Record<Exclude<TipId, "pullRequest">, { title: string; body: string }> = {
  conflict: {
    title: "Two changes touched the same lines",
    body: "Git couldn't combine them on its own. Open each conflicted file, keep the right version of every conflict (or both), then mark the file as resolved. Abort in the banner above puts everything back as it was.",
  },
  detached: {
    title: "You're not on a branch",
    body: "You're looking at a single commit (a “detached HEAD”). You can look around safely, but new commits here belong to no branch. Create a branch first if you want to keep work you do now.",
  },
  stage: {
    title: "Choose what goes into your next commit",
    body: "Changed files aren't committed automatically. Stage the files (or single lines) you want in the next commit; the rest stays here for later.",
  },
  commit: {
    title: "Save a snapshot",
    body: "Staged changes become a commit when you write a short message saying what you changed and why. Commits stay on this computer until you push.",
  },
  publish: {
    title: "Your commits are only on this computer",
    body: "This branch hasn't been pushed yet. Publish it to send your commits to the remote so others (and your other computers) can see them.",
  },
};

/** Which tip fits the repository's state right now, most urgent first. */
export function tipFor(status: RepoStatus): Exclude<TipId, "pullRequest">[] {
  const files = status.files;
  const out: Exclude<TipId, "pullRequest">[] = [];
  if (files.some((f) => f.area === "conflicted")) out.push("conflict");
  if (status.branch.detached) out.push("detached");
  if (files.some((f) => f.area === "staged")) out.push("commit");
  else if (files.length > 0) out.push("stage");
  if (files.length === 0 && !status.branch.unborn && !status.branch.detached && !status.branch.upstream) out.push("publish");
  return out;
}

/** One beginner tip above the changed files, if any applies and wasn't closed. */
export function ChangesTip({ status }: { status: RepoStatus }) {
  const { settings } = useStore();
  if (!settings?.tips) return null;
  const id = tipFor(status).find((t) => !settings.dismissedTips.includes(t));
  if (!id) return null;
  return (
    <Tip id={id} title={TIPS[id].title} className="mx-3 mt-2">
      {TIPS[id].body}
    </Tip>
  );
}
