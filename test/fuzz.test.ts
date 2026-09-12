/**
 * Invariant fuzzing for both conversion paths. We do not assert exact output
 * for generated input — we assert the converter never throws under documented
 * policies and that its output obeys the Portable Text structural contract.
 */
import { describe, expect, it } from "vitest";

import {
  lexicalToPortableText,
  portableTextToLexical,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import { CalloutNode, calloutLoad, calloutSave } from "./callout.js";
import { mulberry32, randomDocument, randomLexicalState } from "./generators.js";
import { factories, makeEditor } from "./helpers.js";

const MARK_NAMES = new Set(["strong", "em", "strike-through", "underline", "code"]);

function assertStructuralInvariants(blocks: PortableTextContent[]): void {
  const keys = new Set<string>();

  for (const block of blocks) {
    expect(typeof block._type).toBe("string");
    expect(block._type.length).toBeGreaterThan(0);
    if (block._key) {
      expect(keys.has(block._key)).toBe(false);
      keys.add(block._key);
    }

    const markDefs = (block as { markDefs?: Array<{ _key?: string }> }).markDefs ?? [];
    const markKeys = new Set(markDefs.map((definition) => String(definition._key)));
    for (const definition of markDefs) {
      if (!definition._key) continue;
      expect(keys.has(definition._key)).toBe(false);
      keys.add(definition._key);
    }

    if ("children" in block) {
      const children = (block as PortableTextBlock).children;
      expect(Array.isArray(children)).toBe(true);
      for (const child of children) {
        const span = child as PortableTextSpan;
        if (span._type !== "span") continue;
        expect(typeof span.text).toBe("string");
        expect(span.text.length).toBeGreaterThan(0);
        if (span._key) {
          expect(keys.has(span._key)).toBe(false);
          keys.add(span._key);
        }
        for (const mark of span.marks ?? []) {
          // Every mark is either a decorator or a declared mark definition.
          expect(MARK_NAMES.has(mark) || markKeys.has(mark), `unresolved mark "${mark}"`).toBe(
            true,
          );
        }
      }
      const style = (block as { style?: string }).style;
      if (style !== undefined) {
        expect(["normal", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"]).toContain(style);
      }
    }
  }
}

describe("fuzz: save path invariants (Lexical → Portable Text)", () => {
  it("never throws and always produces structurally valid blocks", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed);
      const input = randomLexicalState(rand);
      const blocks = lexicalToPortableText(input, {
        onUnmapped: () => {
          /* dropped decorators are expected in the fuzz mix */
        },
      });
      assertStructuralInvariants(blocks as PortableTextContent[]);
    }
  });

  it("throws on unknown nodes only when asked to", () => {
    for (let seed = 301; seed <= 340; seed += 1) {
      const rand = mulberry32(seed);
      const input = randomLexicalState(rand);
      // Default is salvage; skip must also never throw.
      expect(() => lexicalToPortableText(input)).not.toThrow();
      expect(() => lexicalToPortableText(input, { onUnknownNode: "skip" })).not.toThrow();
    }
  });
});

describe("fuzz: load path invariants (Portable Text → Lexical)", () => {
  it("never throws and the re-saved output is structurally valid", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed);
      const document = randomDocument(rand, { callouts: true });
      const editor = makeEditor([CalloutNode]);

      expect(() => portableTextToLexical(editor, document, calloutLoad)).not.toThrow();

      const saved = lexicalToPortableText(editor, calloutSave) as PortableTextContent[] | undefined;
      assertStructuralInvariants(saved ?? []);
    }
  });

  it("keeps every load-path conversion allocatable for 100 seeds", () => {
    for (let seed = 401; seed <= 500; seed += 1) {
      const rand = mulberry32(seed);
      const document = randomDocument(rand);
      const editor = makeEditor();
      portableTextToLexical(editor, document, { factories });
      const saved = lexicalToPortableText(editor) as PortableTextContent[];
      expect(saved.length).toBeGreaterThan(0);
      assertStructuralInvariants(saved);
    }
  });
});
