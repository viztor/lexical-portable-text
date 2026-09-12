import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARK_NAMES,
  LEXICAL_FORMAT,
  formatToMarks,
  marksToFormat,
  type LexicalDecorator,
} from "../src/index.js";

describe("formatToMarks", () => {
  it("returns nothing for an empty format", () => {
    expect(formatToMarks(0)).toEqual([]);
  });

  it("maps every default decorator in declaration order", () => {
    const format =
      LEXICAL_FORMAT.bold |
      LEXICAL_FORMAT.italic |
      LEXICAL_FORMAT.strikethrough |
      LEXICAL_FORMAT.underline |
      LEXICAL_FORMAT.code;
    expect(formatToMarks(format)).toEqual(["strong", "em", "strike-through", "underline", "code"]);
  });

  it("drops sub/sup/highlight by default and reports them", () => {
    const dropped: LexicalDecorator[] = [];
    const format = LEXICAL_FORMAT.subscript | LEXICAL_FORMAT.superscript | LEXICAL_FORMAT.highlight;
    expect(formatToMarks(format, { onUnmapped: (d) => dropped.push(d) })).toEqual([]);
    expect(dropped).toEqual(["subscript", "superscript", "highlight"]);
  });

  it("supports custom mark names", () => {
    expect(formatToMarks(LEXICAL_FORMAT.bold, { names: { bold: "b" } })).toEqual(["b"]);
  });

  it("drops a decorator explicitly mapped to null and reports it", () => {
    const dropped: LexicalDecorator[] = [];
    expect(
      formatToMarks(LEXICAL_FORMAT.italic, {
        names: { italic: null },
        onUnmapped: (d) => dropped.push(d),
      }),
    ).toEqual([]);
    expect(dropped).toEqual(["italic"]);
  });

  it("ignores unknown bits", () => {
    expect(formatToMarks(1024 | LEXICAL_FORMAT.bold)).toEqual(["strong"]);
  });
});

describe("marksToFormat", () => {
  it("maps default mark names back to bits", () => {
    expect(marksToFormat(["strong", "em"])).toBe(LEXICAL_FORMAT.bold | LEXICAL_FORMAT.italic);
  });

  it("ignores unknown mark names", () => {
    expect(marksToFormat(["strong", "mystery"])).toBe(LEXICAL_FORMAT.bold);
  });

  it("respects custom names", () => {
    expect(marksToFormat(["b", "strong"], { names: { bold: "b" } })).toBe(LEXICAL_FORMAT.bold);
  });

  it("round-trips the default decorator set", () => {
    const format =
      LEXICAL_FORMAT.bold |
      LEXICAL_FORMAT.italic |
      LEXICAL_FORMAT.strikethrough |
      LEXICAL_FORMAT.underline |
      LEXICAL_FORMAT.code;
    expect(marksToFormat(formatToMarks(format))).toBe(format);
  });

  it("round-trips opt-in decorators when names are provided", () => {
    const names = { subscript: "sub", superscript: "sup" } as const;
    const format = LEXICAL_FORMAT.subscript | LEXICAL_FORMAT.superscript;
    expect(marksToFormat(formatToMarks(format, { names }), { names })).toBe(format);
  });

  it("ignores undefined marks defensively", () => {
    expect(marksToFormat([])).toBe(0);
  });
});

describe("DEFAULT_MARK_NAMES", () => {
  it("matches the Portable Text ecosystem conventions", () => {
    expect(DEFAULT_MARK_NAMES).toEqual({
      bold: "strong",
      italic: "em",
      strikethrough: "strike-through",
      underline: "underline",
      code: "code",
      subscript: null,
      superscript: null,
      highlight: null,
    });
  });
});

describe("mark name collisions", () => {
  it("throws when two decorators map to the same mark name", () => {
    expect(() => marksToFormat(["em"], { names: { bold: "em" } })).toThrow(/Duplicate mark name/);
    expect(() => formatToMarks(1, { names: { bold: "em" } })).toThrow(/Duplicate mark name/);
  });

  it("accepts a remap that keeps names unique", () => {
    const names = { bold: "b", italic: "i" } as const;
    expect(marksToFormat(["b", "i"], { names })).toBe(LEXICAL_FORMAT.bold | LEXICAL_FORMAT.italic);
  });
});

describe("exhaustive decorator combinations", () => {
  it("round-trips all 32 combinations of the five default decorators", () => {
    const bits = [
      LEXICAL_FORMAT.bold,
      LEXICAL_FORMAT.italic,
      LEXICAL_FORMAT.strikethrough,
      LEXICAL_FORMAT.underline,
      LEXICAL_FORMAT.code,
    ];
    for (let mask = 0; mask < 32; mask += 1) {
      let format = 0;
      bits.forEach((bit, index) => {
        if (mask & (1 << index)) format |= bit;
      });
      const marks = formatToMarks(format);
      expect(marksToFormat(marks)).toBe(format);
    }
  });

  it("emits marks in declaration order for every combination", () => {
    const order = ["strong", "em", "strike-through", "underline", "code"];
    for (let mask = 0; mask < 32; mask += 1) {
      let format = 0;
      [
        LEXICAL_FORMAT.bold,
        LEXICAL_FORMAT.italic,
        LEXICAL_FORMAT.strikethrough,
        LEXICAL_FORMAT.underline,
        LEXICAL_FORMAT.code,
      ].forEach((bit, index) => {
        if (mask & (1 << index)) format |= bit;
      });
      const marks = formatToMarks(format);
      expect(marks).toEqual(order.filter((name) => marks.includes(name)));
    }
  });
});
