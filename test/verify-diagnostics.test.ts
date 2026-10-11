/**
 * Failure-path coverage for `verifySetup`.
 *
 * `verify.ts` exists to tell an integrator *what is wrong* with their setup, so
 * the diagnostics are the product. The main suite only exercises the passing
 * paths; these tests drive every probe into its failure branch and assert the
 * message a user would actually read.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  allSetupChecksPassed,
  formatSetupChecks,
  type SetupCheck,
  verifySetup,
} from "../src/index.js";
import { factories, makeEditor } from "./helpers.js";

function checkNamed(checks: readonly SetupCheck[], name: string): SetupCheck {
  const found = checks.find((check) => check.name === name);
  if (!found) {
    throw new Error(`no check named "${name}" (got: ${checks.map((c) => c.name).join(", ")})`);
  }
  return found;
}

describe("verifySetup diagnostics", () => {
  describe("savePipeline", () => {
    it("reports when the probe span does not survive", () => {
      const checks = verifySetup({
        save: { rules: [{ type: "paragraph", toPortableText: () => ({ _type: "x", _key: "x" }) }] },
      });
      const check = checkNamed(checks, "savePipeline");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/expected probe span text "probe"/);
    });

    it("reports when the save pipeline throws", () => {
      const checks = verifySetup({
        save: {
          rules: [
            {
              type: "paragraph",
              toPortableText: () => {
                throw new Error("pipeline boom");
              },
            },
          ],
        },
      });
      const check = checkNamed(checks, "savePipeline");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/save pipeline threw: pipeline boom/);
    });
  });

  describe("saveRules", () => {
    it("reports a rule that produces no output", () => {
      const checks = verifySetup({
        save: { rules: [{ type: "custom", toPortableText: () => [] }] },
      });
      const check = checkNamed(checks, "saveRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/rule for "custom" produced no Portable Text output/);
    });

    it("reports a rule that throws", () => {
      const checks = verifySetup({
        save: {
          rules: [
            {
              type: "custom",
              toPortableText: () => {
                throw new Error("rule boom");
              },
            },
          ],
        },
      });
      const check = checkNamed(checks, "saveRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/save rule "custom" threw: rule boom/);
    });
  });

  describe("saveAnnotationRules", () => {
    it("reports when no text block is produced", () => {
      const checks = verifySetup({
        save: {
          annotationRules: [{ type: "note", toPortableText: () => ({ _type: "note", _key: "n" }) }],
          rules: [{ type: "paragraph", toPortableText: () => ({ _type: "x", _key: "x" }) }],
        },
      });
      const check = checkNamed(checks, "saveAnnotationRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/annotation rule "note" produced no text block/);
    });

    it("reports a rule that emits no markDefs", () => {
      const checks = verifySetup({
        save: { annotationRules: [{ type: "note", toPortableText: () => null }] },
      });
      const check = checkNamed(checks, "saveAnnotationRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/annotation rule "note" produced no markDefs/);
    });

    it("reports a rule that throws", () => {
      const checks = verifySetup({
        save: {
          annotationRules: [
            {
              type: "note",
              toPortableText: () => {
                throw new Error("annot boom");
              },
            },
          ],
        },
      });
      const check = checkNamed(checks, "saveAnnotationRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/annotation rule "note" threw: annot boom/);
    });
  });

  describe("loadRules", () => {
    it("reports a rule that throws", () => {
      const checks = verifySetup({
        load: {
          factories,
          rules: [
            {
              type: "custom",
              toLexical: () => {
                throw new Error("load boom");
              },
            },
          ],
        },
        editor: makeEditor(),
      });
      const check = checkNamed(checks, "loadRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/load rule "custom" threw: load boom/);
    });
  });

  describe("loadAnnotationRules", () => {
    it("reports when load options are given without an editor", () => {
      const checks = verifySetup({
        load: { factories, annotationRules: [{ type: "note", toLexical: () => null }] },
      });
      const check = checkNamed(checks, "loadAnnotationRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/requires both "load" \(with factories\) and an "editor"/);
    });

    it("reports a rule that throws", () => {
      const checks = verifySetup({
        load: {
          factories,
          annotationRules: [
            {
              type: "note",
              toLexical: () => {
                throw new Error("annot load boom");
              },
            },
          ],
        },
        editor: makeEditor(),
      });
      const check = checkNamed(checks, "loadAnnotationRules");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/load annotation rule "note" threw: annot load boom/);
    });
  });

  describe("markNames", () => {
    it("accepts a decorator explicitly dropped with null", () => {
      const checks = verifySetup({ save: { names: { bold: null } } });
      const check = checkNamed(checks, "markNames");
      expect(check.ok).toBe(true);
      expect(check.problems).toEqual([]);
    });

    it("reports a duplicate mark name as a thrown check", () => {
      const checks = verifySetup({ save: { names: { bold: "em", italic: "em" } } });
      const check = checkNamed(checks, "markNames");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/mark name check threw: .*Duplicate mark name/);
    });
  });

  describe("roundTripProbe", () => {
    it("reports a re-save that produces no blocks", () => {
      const checks = verifySetup({
        save: { rules: [{ type: "paragraph", toPortableText: () => [] }] },
        load: { factories },
        editor: makeEditor(),
      });
      const check = checkNamed(checks, "roundTripProbe");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/re-save of the probe editor produced no blocks/);
    });

    it("reports a re-save whose text changed", () => {
      const checks = verifySetup({
        save: {
          rules: [{ type: "text", toPortableText: () => ({ _type: "mention", _key: "m" }) }],
        },
        load: { factories },
        editor: makeEditor(),
      });
      const check = checkNamed(checks, "roundTripProbe");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/re-save of the probe editor produced unexpected text/);
    });

    it("reports a throwing round trip", () => {
      const checks = verifySetup({
        load: {
          factories,
          rules: [
            {
              type: "normal",
              toLexical: () => {
                throw new Error("rt boom");
              },
            },
          ],
        },
        editor: makeEditor(),
      });
      const check = checkNamed(checks, "roundTripProbe");
      expect(check.ok).toBe(false);
      expect(check.problems[0]).toMatch(/round-trip probe threw: rt boom/);
    });
  });

  describe("reporting helpers", () => {
    it("formats failing checks with their problems", () => {
      const output = formatSetupChecks([
        { name: "alpha", ok: true, problems: [] },
        { name: "beta", ok: false, problems: ["first", "second"] },
      ]);
      expect(output).toContain("✔ alpha");
      expect(output).toContain("✘ beta");
      expect(output).toContain("- first");
      expect(output).toContain("- second");
      expect(output.split("\n")).toEqual(["✔ alpha", "✘ beta", "  - first", "  - second"]);
    });

    it("allSetupChecksPassed is false when any check fails", () => {
      expect(allSetupChecksPassed([{ name: "a", ok: true, problems: [] }])).toBe(true);
      expect(
        allSetupChecksPassed([
          { name: "a", ok: true, problems: [] },
          { name: "b", ok: false, problems: ["p"] },
        ]),
      ).toBe(false);
    });
  });
});
