/**
 * Draft release notes from the commit log.
 *
 * `gh release create --generate-notes` groups changes by *merged pull
 * request*. This repository commits straight to main, so for v0.3.0 it
 * produced notes that listed a single dependency PR and credited a "first
 * contribution" that never happened — the 19 commits behind the release were
 * dropped entirely.
 *
 * This walks the commits between the previous tag and the release instead and
 * groups them by conventional-commit type, so the notes start from something
 * truthful. A release manager can still expand them before publishing.
 *
 * Usage: node scripts/release-notes.mjs [currentTag] [toRef]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** Conventional-commit type → section heading, in the order they print. */
const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["refactor", "Refactoring"],
  ["perf", "Performance"],
  ["test", "Tests"],
  ["ci", "CI"],
  ["docs", "Documentation"],
  ["chore", "Chores"],
];

const tags = git("tag", "--sort=-v:refname").split("\n").filter(Boolean);
const to = process.argv[3] ?? "HEAD";
const current =
  process.argv[2] ?? git("tag", "--points-at", to).split("\n").filter(Boolean)[0] ?? tags[0];
const previous = tags.find((tag) => tag !== current);

const range = previous ? `${previous}..${to}` : to;
const raw = git("log", "--no-merges", "--format=%h%x1f%s%x1f%b%x1e", range);

/** The release commit itself is noise in its own notes. */
const isReleaseCommit = (subject) => /^(chore|release)(\(.+\))?!?:\s*(v?\d|release)/i.test(subject);

const buckets = new Map(SECTIONS.map(([type]) => [type, []]));
const other = [];

for (const record of raw.split("\x1e")) {
  // git separates records with a newline, so the first field arrives padded.
  const [rawHash, rawSubject] = record.split("\x1f");
  const hash = rawHash?.trim();
  const subject = rawSubject?.trim();
  if (!hash || !subject || isReleaseCommit(subject)) continue;
  const match = /^([a-z]+)(\(.+?\))?!?:\s*(.+)$/i.exec(subject);
  const type = match?.[1]?.toLowerCase();
  const summary = match?.[3] ?? subject;
  const line = `- ${summary} (\`${hash}\`)`;
  if (type && buckets.has(type)) buckets.get(type).push(line);
  else other.push(line);
}

const out = [];
for (const [type, heading] of SECTIONS) {
  const lines = buckets.get(type);
  if (lines.length > 0) out.push(`## ${heading}`, "", ...lines, "");
}
if (other.length > 0) out.push("## Other changes", "", ...other, "");

if (out.length === 0) {
  out.push("No user-facing changes.", "");
}

if (previous) {
  const repository =
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).repository?.url ?? "";
  const slug = /github\.com[/:]([^/]+\/[^/.]+)/.exec(repository)?.[1];
  const compare = slug
    ? `https://github.com/${slug}/compare/${previous}...${current}`
    : `${previous}...${current}`;
  out.push(`**Full Changelog**: ${compare}`);
}

process.stdout.write(`${out.join("\n").trimEnd()}\n`);
