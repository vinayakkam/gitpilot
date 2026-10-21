import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleDashed, Copy, ExternalLink, SquareTerminal } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openLink } from "@/lib/links";
import type { CommitSummary } from "@/bindings/CommitSummary";
import type { RepoStatus } from "@/bindings/RepoStatus";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { TextArea } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Misc";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";

interface Ctx {
  repo: string;
  status: RepoStatus;
  recent: CommitSummary[];
  lastError: string | null;
}

function fileList(status: RepoStatus, areas: string[], max = 25): string {
  const files = [...new Set(status.files.filter((f) => areas.includes(f.area)).map((f) => f.path))];
  if (!files.length) return "(none)";
  return files.slice(0, max).map((f) => `- ${f}`).join("\n") + (files.length > max ? `\n- …and ${files.length - max} more` : "");
}

function branchLine(s: RepoStatus): string {
  const b = s.branch;
  if (b.detached) return `HEAD is detached at ${b.oid?.slice(0, 10)}.`;
  if (b.unborn) return `On branch ${b.head}, which has no commits yet.`;
  if (!b.upstream) return `On branch ${b.head} (not published to a remote).`;
  return `On branch ${b.head}, tracking ${b.upstream} (${b.ahead ?? 0} ahead, ${b.behind ?? 0} behind as of the last fetch).`;
}

const TEMPLATES: { id: string; title: string; build: (c: Ctx) => string }[] = [
  {
    id: "explain",
    title: "Explain the current changes",
    build: (c) =>
      `${branchLine(c.status)}\n\nExplain what my uncommitted changes in this repository do and why they might have been made. Use \`git diff\` and \`git diff --cached\` to read them.\n\nChanged files:\n${fileList(c.status, ["staged", "unstaged", "untracked", "conflicted"])}`,
  },
  {
    id: "review-staged",
    title: "Review staged changes for bugs",
    build: (c) =>
      `${branchLine(c.status)}\n\nReview my staged changes (\`git diff --cached\`) for bugs, edge cases and unclear code. List concrete problems with file and line references, most important first. Don't modify any files.\n\nStaged files:\n${fileList(c.status, ["staged"])}`,
  },
  {
    id: "commit-message",
    title: "Suggest a commit message",
    build: (c) =>
      `Read my staged changes with \`git diff --cached\` and suggest a commit message: a specific subject line under 72 characters and, if useful, a short body explaining why. Don't run git commit.\n\nStaged files:\n${fileList(c.status, ["staged"])}`,
  },
  {
    id: "review-branch",
    title: "Review the current branch",
    build: (c) => {
      const base = c.status.branch.upstream ?? "main";
      return `${branchLine(c.status)}\n\nReview the commits on this branch that aren't on ${base} (\`git log ${base}..HEAD\` and \`git diff ${base}...HEAD\`). Point out bugs, risky changes and anything that needs tests. Don't modify files.\n\nRecent commits:\n${c.recent.slice(0, 8).map((x) => `- ${x.shortHash} ${x.subject}`).join("\n") || "(none)"}`;
    },
  },
  {
    id: "pr-summary",
    title: "Prepare a pull request summary",
    build: (c) =>
      `${branchLine(c.status)}\n\nWrite a pull request description for this branch: a short summary, a bullet list of the main changes, and notes for reviewers (risks, testing done, follow-ups). Base it on \`git log\` and \`git diff\` against ${c.status.branch.upstream ?? "the main branch"}.`,
  },
  {
    id: "security",
    title: "Find potential security issues",
    build: (c) =>
      `${branchLine(c.status)}\n\nCheck my current changes (\`git diff\` and \`git diff --cached\`) for security problems: injection, unsafe deserialization, secrets committed by mistake, missing authorization checks, unsafe file or process handling. Explain each finding and how to fix it. Don't modify files.\n\nChanged files:\n${fileList(c.status, ["staged", "unstaged", "untracked"])}`,
  },
  {
    id: "tests",
    title: "Suggest tests for the current changes",
    build: (c) =>
      `${branchLine(c.status)}\n\nLook at my current changes and suggest tests that would catch regressions in them. Follow the project's existing test style and tell me where each test should go.\n\nChanged files:\n${fileList(c.status, ["staged", "unstaged", "untracked"])}`,
  },
  {
    id: "failing-test",
    title: "Investigate a failing test",
    build: (c) =>
      `${branchLine(c.status)}\n\nA test is failing. Find the cause and propose a fix. Check whether my uncommitted changes are responsible.\n\nTest output:\n<paste the failing test output here>`,
  },
  {
    id: "git-error",
    title: "Explain a Git error",
    build: (c) =>
      `${branchLine(c.status)}\n\nExplain this Git error in plain language and tell me the safest way to resolve it. Don't run commands that rewrite history or discard changes without asking me first.\n\nError:\n${c.lastError ?? "<paste the error here>"}`,
  },
];

export function AssistantView() {
  const { activeRepo, status, revision, toasts, settings, notify, setPage } = useStore();
  const id = activeRepo?.id;
  const claude = useAsync(() => api.claudeDetect(), [revision, settings?.claudeCode.path, settings?.claudeCode.terminal]);
  const recent = useAsync(() => api.log(id!, { rev: null, skip: 0, limit: 10, search: null, path: null }), [id, revision], id != null);
  const [tpl, setTpl] = useState(TEMPLATES[0]!.id);
  const [prompt, setPrompt] = useState("");
  const [edited, setEdited] = useState(false);
  const [launching, setLaunching] = useState(false);

  const lastError = useMemo(() => {
    const e = [...toasts].reverse().find((t) => t.error)?.error;
    return e ? `${e.message}${e.detail ? `\n${e.detail}` : ""}` : null;
  }, [toasts]);

  const ctx: Ctx | null = status && activeRepo ? { repo: activeRepo.name, status, recent: recent.data?.commits ?? [], lastError } : null;

  // Refill the editor from the template whenever context changes, unless the user edited it.
  useEffect(() => {
    if (!ctx || edited) return;
    const t = TEMPLATES.find((x) => x.id === tpl);
    if (t) setPrompt(t.build(ctx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, status, recent.data, edited, lastError]);

  if (!activeRepo || id == null) return null;

  const launch = async (withPrompt: boolean) => {
    setLaunching(true);
    try {
      await api.claudeLaunch(id, withPrompt ? prompt : null);
      notify({ tone: "success", title: "Opened Claude Code in a new terminal" });
    } catch (e) {
      notify({ tone: "error", title: "Couldn't open Claude Code", error: toAppError(e) });
    } finally {
      setLaunching(false);
    }
  };

  const counts = status
    ? {
        staged: new Set(status.files.filter((f) => f.area === "staged").map((f) => f.path)).size,
        unstaged: new Set(status.files.filter((f) => f.area === "unstaged" || f.area === "conflicted").map((f) => f.path)).size,
        untracked: status.files.filter((f) => f.area === "untracked").length,
      }
    : null;
  const found = claude.data?.found;
  const sendPrompt = settings?.claudeCode.sendPromptOnLaunch ?? true;

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-border">
        <div className="border-b border-border px-4 py-3 text-sm">
          <h2 className="mb-2 text-md font-semibold">Context</h2>
          {status && counts ? (
            <dl className="grid grid-cols-[84px_1fr] gap-y-1">
              <dt className="text-muted">Repository</dt><dd className="truncate">{activeRepo.name}</dd>
              <dt className="text-muted">Branch</dt><dd className="truncate font-mono text-xs leading-5">{status.branch.head ?? "detached"}</dd>
              <dt className="text-muted">Staged</dt><dd>{plural(counts.staged, "file")}</dd>
              <dt className="text-muted">Unstaged</dt><dd>{plural(counts.unstaged, "file")}</dd>
              <dt className="text-muted">New</dt><dd>{plural(counts.untracked, "file")}</dd>
              <dt className="text-muted">Last commit</dt><dd className="truncate">{recent.data?.commits[0]?.subject ?? "none"}</dd>
            </dl>
          ) : (
            <Spinner />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2" role="listbox" aria-label="Prompt templates">
          <h3 className="px-4 pb-1 text-sm font-semibold text-muted">Templates</h3>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={tpl === t.id}
              onClick={() => {
                setTpl(t.id);
                setEdited(false);
              }}
              className={cx("mx-2 flex h-8 w-[calc(100%-16px)] items-center rounded px-2 text-left text-base", tpl === t.id ? "bg-selection" : "hover:bg-surface-2")}
            >
              {t.title}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5 text-sm">
          {claude.loading && !claude.data ? (
            <Spinner />
          ) : found ? (
            <>
              <CircleCheck size={15} className="shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate">
                Claude Code {claude.data?.version ? <span className="text-muted">{claude.data.version}</span> : null}
                <span className="ml-2 font-mono text-xs text-faint">{claude.data?.path}</span>
              </span>
            </>
          ) : (
            <>
              <CircleDashed size={15} className="shrink-0 text-faint" />
              <span className="flex-1">Claude Code wasn't found on this computer. Install it, or set its location in Settings.</span>
              <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => void openLink("https://docs.claude.com/en/docs/claude-code/setup")}>Install guide</Button>
              <Button size="sm" onClick={() => setPage("settings")}>Settings</Button>
            </>
          )}
        </div>
        {claude.error && <ErrorNotice className="m-3" error={claude.error} />}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <label htmlFor="assistant-prompt" className="mb-1.5 flex items-center justify-between text-sm font-medium">
            Prompt
            {edited && (
              <button type="button" className="text-sm font-normal text-accent-text hover:underline" onClick={() => setEdited(false)}>
                Reset to template
              </button>
            )}
          </label>
          <TextArea
            id="assistant-prompt"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setEdited(true);
            }}
            className="min-h-0 flex-1 font-mono text-sm leading-5"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<SquareTerminal size={14} />} disabled={!found} loading={launching} onClick={() => void launch(sendPrompt)}>
              {sendPrompt ? "Open in Claude Code with this prompt" : "Open Claude Code"}
            </Button>
            {sendPrompt && (
              <Button disabled={!found || launching} onClick={() => void launch(false)}>Open without prompt</Button>
            )}
            <Button icon={<Copy size={13} />} onClick={() => void writeText(prompt).then(() => notify({ tone: "success", title: "Prompt copied" }))}>
              Copy prompt
            </Button>
          </div>
          <p className="mt-2 text-sm text-faint">
            Claude Code opens in its own terminal window in {activeRepo.name}. It works there independently; GitPilot doesn't run anything it suggests.
            The prompt includes file names and branch info only, not file contents.
          </p>
        </div>
      </div>
    </div>
  );
}
