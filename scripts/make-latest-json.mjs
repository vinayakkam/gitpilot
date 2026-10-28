#!/usr/bin/env node
// Builds latest.json, the manifest GitPilot's updater reads, from signed installers.
//
//   node scripts/make-latest-json.mjs <artifact-dir> <owner/repo> <version> [out-file]
//
// <artifact-dir> is searched recursively for installers that have a matching .sig file.
// Download URLs point at the GitHub release "v<version>" of <owner/repo>.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { plainNotes } from "./notes.mjs";

const [dir, repo, version, out = "latest.json"] = process.argv.slice(2);
if (!dir || !repo || !version) {
  console.error("usage: make-latest-json.mjs <artifact-dir> <owner/repo> <version> [out-file]");
  process.exit(2);
}

function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dir);
const base = process.env.GITPILOT_DOWNLOAD_BASE ?? `https://github.com/${repo}/releases/download/v${version}`;
const entry = (re) => {
  const file = files.find((f) => re.test(basename(f)) && files.includes(`${f}.sig`));
  if (!file) return null;
  return { signature: readFileSync(`${file}.sig`, "utf8").trim(), url: `${base}/${encodeURIComponent(basename(file))}` };
};

const nsis = entry(/_x64-setup\.exe$/);
const msi = entry(/_x64_[\w-]+\.msi$/);
const appimage = entry(/_amd64\.AppImage$/);
const deb = entry(/_amd64\.deb$/);
const pacman = entry(/-x86_64\.pkg\.tar\.zst$/);

const platforms = {};
if (nsis) platforms["windows-x86_64-nsis"] = nsis;
if (msi) platforms["windows-x86_64-msi"] = msi;
if (nsis ?? msi) platforms["windows-x86_64"] = nsis ?? msi;
if (appimage) platforms["linux-x86_64-appimage"] = appimage;
if (deb) platforms["linux-x86_64-deb"] = deb;
// Read by Arch installs (src-tauri/src/updates.rs, PACMAN_TARGET), which install it with pacman.
if (pacman) platforms["linux-x86_64-pacman"] = pacman;
if (appimage) platforms["linux-x86_64"] = appimage;

if (Object.keys(platforms).length === 0) {
  console.error("No signed installers found (expected *.sig next to each installer).");
  process.exit(1);
}

// Release notes: this version's section of CHANGELOG.md, if present.
let notes = `GitPilot ${version}`;
try {
  const log = readFileSync("CHANGELOG.md", "utf8");
  const m = log.match(new RegExp(`^## ${version.replace(/\./g, "\\.")}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  if (m) notes = plainNotes(m[1]);
} catch {
  /* no changelog */
}

const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out} with ${Object.keys(platforms).join(", ")}`);
