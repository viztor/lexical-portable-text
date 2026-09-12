/**
 * Property-based round-trip tests.
 *
 * A seeded PRNG generates varied Portable Text documents; every document must
 * survive PT → Lexical → PT (value-canonical) and be idempotent on a second
 * pass. The generator deliberately avoids the documented lossy cases
 * (task lists, non-link mark definitions, level jumps, breaks inside links).
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
import { mulberry32, randomDocument } from "./generators.js";
import { canonicalize, factories, makeEditor } from "./helpers.js";

function roundTrip(
  blocks: readonly PortableTextContent[],
  options: {
    load?: Parameters<typeof portableTextToLexical>[2];
    save?: Parameters<typeof lexicalToPortableText>[1];
  } = {},
): PortableTextContent[] {
  const editor = makeEditor([CalloutNode]);
  portableTextToLexical(editor, blocks, options.load ?? { factories });
  return lexicalToPortableText(editor, options.save ?? {}) as PortableTextContent[];
}

describe("property: seeded documents round-trip", () => {
  it("round-trips and is idempotent for 200 generated documents", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = mulberry32(seed);
      const document = randomDocument(rand);

      const first = roundTrip(document);
      expect(canonicalize(first), `seed ${seed} first pass`).toEqual(canonicalize(document));

      const second = roundTrip(first);
      expect(canonicalize(second), `seed ${seed} second pass`).toEqual(canonicalize(first));
    }
  });

  it("round-trips 100 generated documents containing custom callouts", () => {
    for (let seed = 1000; seed < 1100; seed += 1) {
      const rand = mulberry32(seed);
      const document = randomDocument(rand, { callouts: true });

      const first = roundTrip(document, {
        load: calloutLoad,
        save: calloutSave,
      });
      expect(canonicalize(first), `seed ${seed} first pass`).toEqual(canonicalize(document));

      const second = roundTrip(first, {
        load: calloutLoad,
        save: calloutSave,
      });
      expect(canonicalize(second), `seed ${seed} second pass`).toEqual(canonicalize(first));
    }
  });

  it("never emits empty span text, and all keys are unique", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const rand = mulberry32(seed);
      const result = roundTrip(randomDocument(rand));
      const keys: string[] = [];

      for (const block of result) {
        if (block._key) keys.push(block._key);
        const markDefs = (block as { markDefs?: Array<{ _key?: string }> }).markDefs ?? [];
        for (const definition of markDefs) {
          if (definition._key) keys.push(definition._key);
        }
        if ("children" in block) {
          for (const child of (block as PortableTextBlock).children) {
            const span = child as PortableTextSpan;
            if (span._type !== "span") continue;
            expect(span.text).not.toBe("");
            if (span._key) keys.push(span._key);
          }
        }
      }

      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
