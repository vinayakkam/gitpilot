import type { ReactNode } from "react";
import { openLink } from "@/lib/links";

// Renders release notes written in a small subset of Markdown (or the plain "• bullet"
// form GitPilot's update manifest uses) as real headings and lists. Builds React elements
// directly: no HTML from the network is ever injected.

type Block = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "para"; text: string } | { kind: "table"; rows: string[][] };

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;

/** Splits notes into headings, bullet lists, tables and paragraphs. */
export function parseNotes(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    const next = (lines[i + 1] ?? "").trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", text: h[1] ?? "" });
      continue;
    }
    if (BULLET.test(raw)) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = raw.replace(BULLET, "").trim();
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }
    if (line.startsWith("|")) {
      flush();
      if (TABLE_RULE.test(line)) continue;
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const last = blocks[blocks.length - 1];
      if (last?.kind === "table") last.rows.push(cells);
      else blocks.push({ kind: "table", rows: [cells] });
      continue;
    }
    // Continuation of the previous bullet (wrapped line, indented).
    const last = blocks[blocks.length - 1];
    if (/^\s+/.test(raw) && last?.kind === "list" && para.length === 0) {
      last.items[last.items.length - 1] += ` ${line}`;
      continue;
    }
    // A short line directly followed by a bullet is a section title ("Added", "Fixed").
    if (para.length === 0 && line.length <= 60 && !/[.:,;]$/.test(line) && BULLET.test(lines[i + 1] ?? "") && next) {
      blocks.push({ kind: "heading", text: line });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** **bold**, `code` and [links](https://…) inside a line. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-text">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++} className="rounded bg-surface-3 px-1 font-mono text-xs">{m[2]}</code>);
    else if (m[3] !== undefined && m[4]) {
      const url = m[4];
      out.push(
        <button key={k++} type="button" onClick={() => void openLink(url)} className="text-accent-text underline-offset-2 hover:underline">
          {m[3]}
        </button>,
      );
    }
    at = re.lastIndex;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Plain bullets ("Accent colours. Pick…") get their short opening sentence in bold,
 *  matching how the changelog emphasises it. Items that already use ** are left alone. */
function leadIn(item: string): ReactNode {
  if (item.includes("**")) return inline(item);
  const cut = item.indexOf(". ");
  if (cut < 3 || cut > 70) return inline(item);
  return (
    <>
      <strong className="font-semibold text-text">{inline(item.slice(0, cut + 1))}</strong> {inline(item.slice(cut + 2))}
    </>
  );
}

export function ReleaseNotes({ source, className }: { source: string; className?: string }) {
  const blocks = parseNotes(source);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <h4 key={i} className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-accent-text first:mt-0">
                {inline(b.text)}
              </h4>
            );
          case "list":
            return (
              <ul key={i} className="my-1 flex flex-col gap-1.5">
                {b.items.map((it, j) => (
                  <li key={j} className="relative pl-3.5 text-muted before:absolute before:left-0 before:top-[0.55em] before:h-1.5 before:w-1.5 before:rounded-sm before:bg-accent">
                    {leadIn(it)}
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <table key={i} className="my-1.5 w-full text-left text-xs">
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-border last:border-b-0">
                      {r.map((c, n) => (
                        <td key={n} className={j === 0 ? "py-1 pr-3 font-semibold text-text" : "py-1 pr-3 text-muted"}>
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          default:
            return (
              <p key={i} className="my-1 text-text">
                {inline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
