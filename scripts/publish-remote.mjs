#!/usr/bin/env node
// Copies the built phone app into the website repository, under `remote/`.
//
// Deliberately dumb: it copies files and prints what changed. It does not commit, does not push,
// and holds no token -- publishing stays something the user does themselves, with their own
// credentials, after looking at the diff.
//
//   npm run build:remote
//   npm run publish:remote -- ../OLIT.github.io

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const BUILD = resolve("dist-remote");
const target = process.argv[2];

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!target) {
  fail(
    "Say where the website repository is:\n  npm run publish:remote -- ../OLIT.github.io\n" +
      "(the folder with that site's CNAME file in it)",
  );
}

const site = resolve(target);
if (!existsSync(site)) fail(`There's no folder at ${site}.`);
if (!existsSync(join(site, ".git"))) fail(`${site} isn't a git repository, so that's probably the wrong folder.`);
if (!existsSync(BUILD)) fail("Nothing has been built yet. Run `npm run build:remote` first.");

const destination = join(site, "remote");

async function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

const before = existsSync(destination) ? await listFiles(destination) : [];
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(BUILD, destination, { recursive: true });
const after = await listFiles(destination);

let bytes = 0;
for (const file of after) bytes += (await stat(join(destination, file))).size;

const added = after.filter((f) => !before.includes(f));
const removed = before.filter((f) => !after.includes(f));

console.log(`\nCopied ${after.length} files (${(bytes / 1024).toFixed(0)} KB) into ${destination}`);
for (const f of added) console.log(`  + ${f}`);
for (const f of removed) console.log(`  - ${f}`);

console.log(
  [
    "",
    "Now publish it yourself, so nothing here needs a token:",
    `  cd ${site}`,
    "  git add remote",
    '  git commit -m "Update the GitPilot remote app"',
    "  git push",
    "",
    "It goes live at https://olittechnologies.co.in/remote/ once GitHub Pages rebuilds.",
    "",
  ].join("\n"),
);
