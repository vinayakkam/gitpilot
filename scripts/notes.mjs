// Turns a CHANGELOG section (Markdown) into plain text for latest.json.
// Older GitPilot versions show update notes as plain text, so the manifest must read well
// without any formatting: section titles on their own line, "•" bullets, no ** or `.
// GitPilot 0.3.1+ renders this format (and Markdown) with headings and lists.

/** @param {string} md */
export function plainNotes(md) {
  const out = [];
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (heading) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(clean(heading[1]));
      continue;
    }
    const bullet = /^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1].length >= 2 ? "  " : ""}• ${clean(bullet[2])}`);
      continue;
    }
    if (/^\s+\S/.test(line) && out.length && /•/.test(out[out.length - 1])) {
      out[out.length - 1] += ` ${clean(line.trim())}`;
      continue;
    }
    if (line.trim() === "" && out[out.length - 1] === "") continue;
    out.push(clean(line.trim()));
  }
  return out.join("\n").trim();
}

/** @param {string} s */
function clean(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
}
