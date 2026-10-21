import { useState } from "react";
import { Copy, Plus, Tag as TagIcon, Trash2, Upload } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Tag } from "@/bindings/Tag";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { relativeTime } from "@/lib/format";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useStore } from "@/store/AppStore";
import { TagDialog } from "./TagDialog";

/** Tags: list, create on the current commit, push, delete (locally and on the remote). */
export function TagsSection({ query }: { query: string }) {
  const { activeRepo, revision, run, busy, status, notify } = useStore();
  const id = activeRepo?.id;
  const tags = useAsync(() => api.tagList(id!), [id, revision], id != null);
  const remotes = useAsync(() => api.remotes(id!), [id], id != null);
  const [create, setCreate] = useState<{ hash: string; label: string } | null>(null);
  const [del, setDel] = useState<Tag | null>(null);
  const [alsoRemote, setAlsoRemote] = useState(false);
  if (id == null) return null;

  const remote = remotes.data?.find((r) => r.name === "origin")?.name ?? remotes.data?.[0]?.name;
  const q = query.trim().toLowerCase();
  const list = (tags.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  const head = status?.branch.oid;

  return (
    <section aria-label="Tags">
      <h3 className="sticky top-0 z-[1] flex h-8 items-center gap-2 border-b border-border bg-surface-2 pl-4 pr-2 text-sm font-semibold text-muted">
        <span className="flex-1">
          Tags <span className="font-normal text-faint">{tags.data?.length ?? 0}</span>
        </span>
        {head && !status?.branch.unborn && (
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => setCreate({ hash: head, label: `the current commit (${head.slice(0, 7)})` })}>
            New tag
          </Button>
        )}
      </h3>
      {list.length ? (
        list.map((t) => (
          <div key={t.name} className="group flex h-9 items-center gap-3 border-b border-border px-4">
            <TagIcon size={14} className="shrink-0 text-faint" />
            <span className="selectable font-mono text-sm">{t.name}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted" title={t.message}>
              {t.message}
            </span>
            <span className="font-mono text-xs text-faint">{t.target.slice(0, 7)}</span>
            {t.time > 0 && <span className="text-xs text-faint">{relativeTime(t.time)}</span>}
            {remote && (
              <Button size="sm" icon={<Upload size={12} />} disabled={!!busy} onClick={() => void run("Push tag", () => api.tagPush(id, remote, t.name, false), { success: `Pushed ${t.name} to ${remote}` })}>
                Push
              </Button>
            )}
            <IconButton size="sm" label="Copy tag name" icon={<Copy size={13} />} onClick={() => void writeText(t.name).then(() => notify({ tone: "success", title: "Tag name copied" }))} />
            <IconButton
              size="sm"
              tone="danger"
              label="Delete tag…"
              icon={<Trash2 size={13} />}
              onClick={() => {
                setAlsoRemote(false);
                setDel(t);
              }}
            />
          </div>
        ))
      ) : (
        <p className="px-4 py-3 text-base text-muted">{q ? `No tags match “${query}”.` : "No tags. Tags mark versions, like v1.0.0. Create one here or from a commit in History."}</p>
      )}

      <TagDialog target={create} onClose={() => setCreate(null)} />
      <ConfirmDialog
        open={del !== null}
        onClose={() => setDel(null)}
        danger
        title={`Delete tag ${del?.name ?? ""}?`}
        confirmLabel="Delete tag"
        onConfirm={async () => {
          if (!del) return;
          const name = del.name;
          await run(
            "Delete tag",
            async () => {
              if (alsoRemote && remote) await api.tagPush(id, remote, name, true);
              await api.tagDelete(id, name);
            },
            { success: alsoRemote ? `Deleted ${name} here and on ${remote}` : `Deleted ${name}`, rethrow: true },
          );
        }}
      >
        <p>The tag is removed from this repository. The commit it points to isn't affected.</p>
        {remote && (
          <div className="mt-3">
            <Checkbox checked={alsoRemote} onChange={setAlsoRemote} label={`Also delete it from ${remote}`} />
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
