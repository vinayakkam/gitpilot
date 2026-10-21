import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { EolReport } from "@/bindings/EolReport";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";

/**
 * Warns before committing files with Windows (CRLF) line endings into an LF repository.
 * Those commits make GitHub show every line as changed, and pull-request suggestions then fail
 * with "context doesn't match". One click rewrites the staged files with LF.
 */
export function LineEndingNotice({ stagedCount }: { stagedCount: number }) {
  const { activeRepo, status, settings, run, notify } = useStore();
  const id = activeRepo?.id;
  const enabled = settings?.checkLineEndings !== false;
  const [report, setReport] = useState<EolReport | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (id == null || !enabled || stagedCount === 0) {
      setReport(null);
      return;
    }
    let live = true;
    api.eolCheck(id).then(
      (r) => live && setReport(r),
      () => live && setReport(null),
    );
    return () => {
      live = false;
    };
  }, [id, enabled, stagedCount, status]);

  if (!id || !report || report.issues.length === 0) return null;
  const n = report.issues.length;
  const onlyEndings = report.issues.every((i) => i.kind === "lineEndingsOnly");

  const fix = async () => {
    const fixed = await run("Fix line endings", () => api.eolFix(id, report.issues.map((i) => i.path)));
    if (fixed) notify({ tone: "success", title: `Converted ${plural(fixed, "file")} to LF line endings` });
  };

  const addAttributes = async () => {
    const added = await run("Add .gitattributes", () => api.eolAddGitattributes(id));
    if (added) notify({ tone: "success", title: "Added * text=auto to .gitattributes", body: "Commit it so everyone's line endings stay consistent." });
  };

  return (
    <div className="mb-2 rounded border border-warning/30 bg-warning-bg text-sm" role="status">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {plural(n, "file")} {n === 1 ? "uses" : "use"} Windows line endings (CRLF)
          </p>
          <p className="mt-0.5 text-muted">
            {onlyEndings ? "Nothing else changed, but" : "This repository uses LF, so"} GitHub would show every line as changed, and pull request suggestions can fail with “context doesn't match”.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={fix}>
              Convert to LF
            </Button>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted hover:text-text">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Files
            </button>
          </div>
          {open && (
            <ul className="mt-1 max-h-28 overflow-y-auto font-mono text-xs">
              {report.issues.map((i) => (
                <li key={i.path} className="truncate" title={i.path}>
                  {i.path} <span className="font-sans text-faint">· {i.kind === "lineEndingsOnly" ? "only line endings changed" : i.newFile ? "new file" : `${plural(i.crlfLines, "CRLF line")}`}</span>
                </li>
              ))}
            </ul>
          )}
          {!report.hasTextRule && (
            <p className="mt-1.5 text-xs text-muted">
              Stop this happening again:{" "}
              <button type="button" onClick={addAttributes} className="text-accent-text underline-offset-2 hover:underline">
                add <span className="font-mono">* text=auto</span> to .gitattributes
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
