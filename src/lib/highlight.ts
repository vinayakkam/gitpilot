// Syntax highlighting for diff lines. Per-line highlighting is fast and safe for partial hunks;
// multi-line constructs (block comments, template strings) may be highlighted imperfectly.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";

const langs = { bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml, ini, dockerfile };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);

const EXT: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  rs: "rust", py: "python", go: "go", java: "java", kt: "kotlin", kts: "kotlin",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cxx: "cpp", cs: "csharp",
  css: "css", scss: "scss", html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  json: "json", jsonc: "json", md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", php: "php", rb: "ruby", sql: "sql", swift: "swift",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", cfg: "ini",
};

export function languageFor(path: string | null | undefined): string | null {
  if (!path) return null;
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return null;
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return EXT[ext] ?? null;
}

const cache = new Map<string, string>();
const MAX_CACHE = 20000;

/** Returns HTML (escaped by highlight.js) or null when no highlighting applies. */
export function highlightLine(line: string, lang: string | null): string | null {
  if (!lang || line.length > 2000) return null;
  const key = `${lang}\u0000${line}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(key, html);
  return html;
}
