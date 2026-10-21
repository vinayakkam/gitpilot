import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@/bindings/FileEntry";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Input } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useStore } from "@/store/AppStore";

/** Escapes characters .gitignore treats specially so a path matches only itself. */
export function escapeIgnore(path: string): string {
  return path.replace(/[*?[\]\\]/g, "\\$&").replace(/^([#!])/, "\\$1").replace(/ $/, "\\ ");
}

function ext(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

type Choice = { id: string; label: string; patterns: string[]; note?: string };

/** Ignore options for the selected files, most specific first. Patterns start with "/" so
 *  they match from the repository root only. */
export function ignoreChoices(paths: string[]): Choice[] {
  const out: Choice[] = [];
  out.push({
    id: "files",
    label: paths.length === 1 ? "Only this file" : `These ${paths.length} files`,
    patterns: paths.map((p) => `/${escapeIgnore(p)}`),
  });
  const exts = new Set(paths.map(ext));
  const e = exts.size === 1 ? [...exts][0] : null;
  if (e) out.push({ id: "ext", label: `All ${e} files`, patterns: [`*${escapeIgnore(e)}`], note: "Anywhere in the repository" });
  const dirs = new Set(paths.map(dirOf));
  const d = dirs.size === 1 ? [...dirs][0] : null;
  if (d) out.push({ id: "dir", label: `The whole ${d.split("/").pop()} folder`, patterns: [`/${escapeIgnore(d)}/`], note: d });
  return out;
}

export function IgnoreDialog({ files, onClose }: { files: FileEntry[] | null; onClose: () => void }) {
  const { activeRepo, run, notify } = useStore();
  const paths = useMemo(() => [...new Set((files ?? []).map((f) => f.path))], [files]);
  const tracked = useMemo(() => [...new Set((files ?? []).filter((f) => f.area !== "untracked").map((f) => f.path))], [files]);
  const choices = useMemo(() => ignoreChoices(paths), [paths]);
  const [choice, setChoice] = useState("files");
  const [custom, setCustom] = useState("");
  const [untrack, setUntrack] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (files) {
      setChoice("files");
      setCustom("");
      setUntrack(true);
    }
  }, [files]);

  const patterns = choice === "custom" ? custom.split("\n").map((s) => s.trim()).filter(Boolean) : (choices.find((c) => c.id === choice)?.patterns ?? []);
  const doUntrack = tracked.length > 0 && untrack;

  const save = async () => {
    if (!activeRepo || patterns.length === 0) return;
    setBusy(true);
    const res = await run("Add to .gitignore", () => api.gitignoreAdd(activeRepo.id, patterns, doUntrack ? tracked : []));
    setBusy(false);
    if (res !== undefined) {
      notify({
        tone: "success",
        title: res.length ? `Added ${plural(res.length, "rule")} to .gitignore` : "Already in .gitignore",
        body: doUntrack ? `Stopped tracking ${plural(tracked.length, "file")}. Commit to finish; the files stay on your computer.` : "Commit .gitignore so everyone ignores the same files.",
      });
      onClose();
    }
  };

  return (
    <Dialog
      open={files !== null}
      onClose={onClose}
      busy={busy}
      width={480}
      title="Add to .gitignore"
      description="Git will stop showing matching new files as changes."
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={patterns.length === 0}>
            {doUntrack ? "Ignore and stop tracking" : "Ignore"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="What to ignore" className="flex flex-col gap-1">
          {[...choices, { id: "custom", label: "Custom pattern", patterns: [] as string[] } as Choice].map((c) => (
            <label key={c.id} className={cx("flex cursor-pointer items-start gap-2.5 rounded border px-2.5 py-2", choice === c.id ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
              <input type="radio" name="ignore-choice" className="mt-0.5 accent-[var(--accent)]" checked={choice === c.id} onChange={() => setChoice(c.id)} data-autofocus={c.id === "files" ? true : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-base">{c.label}</span>
                {c.note && <span className="block truncate text-sm text-muted">{c.note}</span>}
              </span>
            </label>
          ))}
        </div>
        {choice === "custom" && (
          <Input aria-label="Custom ignore pattern" autoFocus placeholder="e.g. *.log, dist/, /secrets.json" value={custom} onChange={(e) => setCustom(e.target.value)} className="font-mono text-sm" />
        )}
        <div>
          <p className="mb-1 text-sm text-muted">Adds to .gitignore:</p>
          <ul className="selectable max-h-28 overflow-y-auto rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs">
            {patterns.length ? patterns.map((p) => <li key={p} className="truncate">{p}</li>) : <li className="font-sans text-faint">Nothing yet</li>}
          </ul>
        </div>
        {tracked.length > 0 && (
          <div className="rounded border border-warning/30 bg-warning-bg p-2.5 text-sm">
            <Checkbox checked={untrack} onChange={setUntrack} label={`Also stop tracking ${tracked.length === 1 ? "this file" : plural(tracked.length, "file")}`} />
            <p className="mt-1 pl-6 text-muted">
              {tracked.length === 1 ? "It's" : "They're"} already in the repository, so .gitignore alone won't hide {tracked.length === 1 ? "it" : "them"}. {tracked.length === 1 ? "It stays" : "They stay"} on your computer; after you commit and push, {tracked.length === 1 ? "it's" : "they're"} removed from the repository and from other people's copies when they pull.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
