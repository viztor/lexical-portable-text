/**
 * Smoke-test the *packed* artifact rather than the working tree.
 *
 * `vp check` / `vp test` exercise `src/`, and `vp pack` exercises `dist/` — but
 * neither proves that what npm would publish actually resolves. A wrong
 * `files` allowlist, a broken `exports` map, or a missing `dist` file would
 * pass every other check and only fail for a consumer.
 *
 * This packs the tarball, unpacks it into a throwaway project, installs it
 * under its published name, and drives the public API from there.
 *
 * Usage: node scripts/smoke-package.mjs
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vp = path.join(root, "node_modules", ".bin", "vp");

/** Every runtime export the package promises. */
const EXPECTED_EXPORTS = [
  "DEFAULT_MARK_NAMES",
  "LEXICAL_FORMAT",
  "WELL_KNOWN_MARK_ALIASES",
  "allSetupChecksPassed",
  "definePipeline",
  "formatSetupChecks",
  "formatToMarks",
  "lexicalToPortableText",
  "marksToFormat",
  "portableTextToLexical",
  "portableTextToLexicalNodes",
  "portableTextToPlainText",
  "randomKey",
  "verifySetup",
];

function fail(message) {
  console.error(`✘ ${message}`);
  process.exit(1);
}

if (!existsSync(vp)) {
  fail(`no vp binary at ${vp} — run \`vp install\` first`);
}

const work = mkdtempSync(path.join(tmpdir(), "lpt-smoke-"));
const consumer = path.join(work, "consumer");

try {
  // 1. Build first: `vp pm pack` packs whatever is on disk, so without this
  //    the tarball would silently have no `dist/` on a clean checkout.
  execFileSync(vp, ["pack"], { cwd: root, stdio: "pipe" });

  // 2. Pack exactly what would be published.
  execFileSync(vp, ["pm", "pack", "--pack-destination", work], { cwd: root, stdio: "pipe" });
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (!tarball) fail("pack produced no tarball");

  // 3. Unpack it the way a registry client would.
  execFileSync("tar", ["-xzf", path.join(work, tarball), "-C", work]);
  const packed = path.join(work, "package");
  if (!existsSync(path.join(packed, "dist", "index.js"))) fail("tarball is missing dist/index.js");
  if (!existsSync(path.join(packed, "dist", "index.d.ts")))
    fail("tarball is missing dist/index.d.ts");

  // 4. Install it under its published name, with the peer/runtime deps linked
  //    from the repo so the resolution graph matches a real consumer.
  mkdirSync(path.join(consumer, "node_modules"), { recursive: true });
  cpSync(packed, path.join(consumer, "node_modules", "lexical-portable-text"), { recursive: true });
  // The whole `@lexical` scope, so subpackages like @lexical/headless resolve.
  for (const dep of ["lexical", "@portabletext", "@lexical"]) {
    symlinkSync(path.join(root, "node_modules", dep), path.join(consumer, "node_modules", dep));
  }
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module" }));

  // 5. Drive the public API by package name (so the exports map is exercised).
  writeFileSync(
    path.join(consumer, "smoke.mjs"),
    `import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import * as api from "lexical-portable-text";

const expected = ${JSON.stringify(EXPECTED_EXPORTS)};
const missing = expected.filter((name) => !(name in api));
if (missing.length > 0) throw new Error("missing exports: " + missing.join(", "));

const factories = {
  text: (value, format) => $createTextNode(value).setFormat(format),
  paragraph: (children) => $createParagraphNode().append(...children),
};

const editor = createHeadlessEditor({ namespace: "smoke", nodes: [], onError: (e) => { throw e; } });
editor.update(() => {
  const p = $createParagraphNode();
  p.append($createTextNode("packed artifact"));
  $getRoot().append(p);
}, { discrete: true });

const state = editor.getEditorState();
const blocks = state.read(() => api.lexicalToPortableText(state.toJSON()));
api.portableTextToLexical(editor, blocks, { factories });
const text = editor.getEditorState().read(() => $getRoot().getTextContent());
if (text !== "packed artifact") throw new Error("round trip lost text: " + JSON.stringify(text));

const plain = api.portableTextToPlainText(blocks);
if (plain !== "packed artifact") throw new Error("plain text mismatch: " + JSON.stringify(plain));

if (api.verifySetup({ load: { factories }, editor }).length === 0) {
  throw new Error("verifySetup returned no checks");
}
console.log("exports:", expected.length, "| round trip:", JSON.stringify(plain));
`,
  );
  const output = execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer }).toString().trim();
  console.log(`✔ packed artifact resolves and works — ${output}`);
} catch (error) {
  const stderr = error?.stderr?.toString().trim();
  fail(
    stderr
      ? stderr.split("\n").slice(0, 12).join("\n")
      : error instanceof Error
        ? error.message
        : String(error),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
