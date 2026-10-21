import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, TextArea } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { useStore } from "@/store/AppStore";

/** Valid tag names follow Git's ref rules; checked again in the backend. */
export function tagNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (/\s/.test(n)) return "Tag names can't contain spaces.";
  if (/[~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\.lock$/.test(n)) return "That isn't a valid tag name.";
  return null;
}

/** Creates a tag on a commit. A message makes it an annotated tag (recommended for releases). */
export function TagDialog({ target, onClose }: { target: { hash: string; label: string } | null; onClose: () => void }) {
  const { activeRepo, run, notify } = useStore();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target) {
      setName("");
      setMessage("");
    }
  }, [target]);
  const problem = tagNameProblem(name);

  const save = async () => {
    if (!activeRepo || !target || !name.trim() || problem) return;
    setBusy(true);
    const ok = await run("Create tag", () => api.tagCreate(activeRepo.id, name.trim(), target.hash, message));
    setBusy(false);
    if (ok !== undefined) {
      notify({ tone: "success", title: `Created tag ${name.trim()}`, body: "Push it from Branches → Tags to share it." });
      onClose();
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      busy={busy}
      title="Create tag"
      description={target ? `On ${target.label}` : undefined}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !!problem}>
            Create tag
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" hint="Version tags usually look like v1.2.0." error={problem ?? undefined}>
          {(p) => <Input {...p} autoFocus placeholder="v1.0.0" value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />}
        </Field>
        <Field label="Message (optional)" hint="With a message, Git stores who tagged it and when (an annotated tag).">
          {(p) => <TextArea {...p} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
