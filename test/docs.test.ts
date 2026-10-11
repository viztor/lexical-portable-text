/**
 * README consistency.
 *
 * The README is the first thing a consumer reads, and it has drifted more than
 * once: a stale test count, a "CI targets 0.50" that outlived the bump, and
 * four public exports that were never mentioned at all. An export nobody can
 * discover is effectively private, so pin that here rather than noticing it by
 * hand a fourth time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import * as api from "../src/index.js";

const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

describe("README", () => {
  it("mentions every public export", () => {
    const missing = Object.keys(api).filter((name) => !readme.includes(name));
    expect(missing, `undocumented exports: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents the current major of every runtime dependency it names", () => {
    // Guard the specific claim that went stale: the peer range printed in the
    // README must match package.json.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { peerDependencies?: Record<string, string> };
    const range = pkg.peerDependencies?.lexical;
    expect(range, "package.json declares no lexical peer range").toBeTruthy();
    expect(readme).toContain(range as string);
  });
});
