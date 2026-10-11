/**
 * Malformed / degenerate input.
 *
 * Real editor state and real Portable Text are not always well-formed: fields
 * are absent, typed wrongly, or empty. These tests pin the documented
 * behaviour on that input — degrade gracefully, never throw — and cover the
 * defensive branches the happy-path suites leave untouched.
 */
import { $isElementNode } from "lexical";
import { describe, expect, it } from "vite-plus/test";

import {
  lexicalToPortableText,
  portableTextToLexicalNodes,
  portableTextToPlainText,
  type ConverterOptions,
  type PortableTextContent,
  type PortableTextToLexicalOptions,
} from "../src/index.js";
import { factories, makeEditor } from "./helpers.js";

/** Save one serialized node and return the blocks. */
function save(node: unknown, options: ConverterOptions = {}): PortableTextContent[] {
  return lexicalToPortableText(
    { root: { type: "root", version: 1, children: [node] } } as never,
    options,
  );
}

interface LoadResult {
  types: string[];
  text: string;
  childCounts: number[];
  missing: string[];
}

/**
 * Load blocks and snapshot the result. Lexical node methods are only valid
 * inside an update/read, so the snapshot is taken inside the callback.
 */
function load(blocks: unknown[], options: Partial<PortableTextToLexicalOptions> = {}): LoadResult {
  const editor = makeEditor();
  const missing: string[] = [];
  const result: LoadResult = { types: [], text: "", childCounts: [], missing };
  editor.update(() => {
    const nodes = portableTextToLexicalNodes(
      blocks as never,
      {
        factories,
        onMissingFactory: (kind) => missing.push(kind),
        ...options,
      } as PortableTextToLexicalOptions,
    );
    result.types = nodes.map((built) => built.getType());
    result.text = nodes.map((built) => built.getTextContent()).join("");
    result.childCounts = nodes.map((built) =>
      $isElementNode(built) ? built.getChildren().length : 0,
    );
  });
  return result;
}

const node = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  version: 1,
  ...extra,
});

describe("robustness — save path", () => {
  it("code: tolerates missing and mistyped fields", () => {
    expect(save(node("code", { children: [] }))[0]).toMatchObject({
      _type: "code",
      language: null,
      code: "",
    });
    expect(save(node("code", { children: [] }))[0]).not.toHaveProperty("filename");

    expect(save(node("code", { code: 42, language: 7, children: [] }))[0]).toMatchObject({
      language: null,
      code: "",
    });
    // Empty and mistyped filenames are dropped rather than emitted.
    expect(save(node("code", { code: "x", filename: "", children: [] }))[0]).not.toHaveProperty(
      "filename",
    );
    expect(save(node("code", { code: "x", filename: 9, children: [] }))[0]).not.toHaveProperty(
      "filename",
    );
  });

  it("code: flattens text, linebreaks and nesting, ignoring untagged children", () => {
    const blocks = save(
      node("code", {
        code: "ignored",
        children: [
          node("code-highlight", { text: "a" }),
          node("text", { text: undefined }),
          node("linebreak"),
          node("wrapper", { children: [node("text", { text: "b" })] }),
          node("mystery"),
        ],
      }),
    );
    // `text` present but undefined contributes nothing; the wrapper recurses.
    expect(blocks[0]).toMatchObject({ code: "a\nb" });
  });

  it("image: reads Lexical's src/altText and carries asset through unchanged", () => {
    expect(save(node("image", { src: "s", altText: "a" }))[0]).toMatchObject({
      _type: "image",
      url: "s",
      alt: "a",
    });
    // `url`/`alt` are accepted as aliases for `src`/`altText`.
    expect(save(node("image", { url: "u", alt: "b" }))[0]).toMatchObject({ url: "u", alt: "b" });
    // `asset` is not a url source on this path (unlike the load path) — it is
    // passed through verbatim so nothing is lost.
    const fromAsset = save(node("image", { asset: { url: "asset-url" } }))[0] as Record<
      string,
      unknown
    >;
    expect(fromAsset.url).toBeUndefined();
    expect(fromAsset.asset).toEqual({ url: "asset-url" });

    // Wrong types and empty strings are dropped.
    const messy = save(
      node("image", {
        url: 42,
        alt: "",
        title: 1,
        caption: null,
        width: "wide",
        height: 10,
        asset: "not-an-object",
      }),
    )[0] as Record<string, unknown>;
    expect(messy).not.toHaveProperty("url");
    expect(messy).not.toHaveProperty("alt");
    expect(messy).not.toHaveProperty("title");
    expect(messy).not.toHaveProperty("caption");
    expect(messy).not.toHaveProperty("width");
    expect(messy).not.toHaveProperty("asset");
    expect(messy.height).toBe(10);
  });

  it("table: tolerates missing rows, missing cells and both row/cell spellings", () => {
    expect(save(node("table"))[0]).toMatchObject({ _type: "table", rows: [] });

    const block = save(
      node("table", {
        children: [
          node("tablerow", {
            children: [node("tablecell", { children: [node("text", { text: "a" })] })],
          }),
          node("table-row", {
            children: [
              node("table-cell", { children: [node("text", { text: "b" })] }),
              node("not-a-cell", { children: [node("text", { text: "ignored" })] }),
            ],
          }),
          node("not-a-row", { children: [] }),
        ],
      }),
    )[0] as unknown as { rows: Array<{ cells: string[] }> };
    expect(block.rows).toEqual([
      { _type: "tableRow", _key: expect.any(String), cells: ["a"] },
      { _type: "tableRow", _key: expect.any(String), cells: ["b"] },
    ]);
  });

  it("horizontal rule: every alias maps to the same block", () => {
    for (const alias of ["hr", "horizontalrule", "horizontal-rule"]) {
      expect(save(node(alias))[0]).toMatchObject({ _type: "horizontal-rule" });
    }
  });
});

describe("robustness — load path", () => {
  it("code: tolerates missing and mistyped fields", () => {
    expect(load([{ _type: "code", _key: "c" }])).toMatchObject({ types: ["code"], text: "" });
    expect(load([{ _type: "code", _key: "c", code: 5, language: 9 }])).toMatchObject({
      types: ["code"],
      text: "",
    });
  });

  it("table: falls back to paragraphs when cell/row factories are absent", () => {
    const result = load([{ _type: "table", _key: "t", rows: [{ cells: ["a", "b"] }, {}] }], {
      factories: {
        text: factories.text,
        paragraph: factories.paragraph,
        table: (rows) => factories.paragraph(rows),
      },
    });
    expect(result.types).toEqual(["paragraph"]);
    // Two rows, each rendered through the paragraph fallback.
    expect(result.childCounts).toEqual([2]);
    expect(result.missing).toEqual([]);
  });

  it("table: without a table factory it reports the gap and falls through to the object factory", () => {
    const result = load([{ _type: "table", _key: "t", rows: [] }], {
      factories: {
        text: factories.text,
        paragraph: factories.paragraph,
        object: (block) => factories.text(String(block._type), 0),
      },
    });
    expect(result.missing).toEqual(["table"]);
    expect(result.text).toBe("table");
  });

  it("image: reads url or asset.url and ignores mistyped fields", () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const imageFactory = {
      text: factories.text,
      paragraph: factories.paragraph,
      image: (_block: unknown, meta?: Record<string, unknown>) => {
        calls.push(meta);
        return factories.text("img", 0);
      },
    };
    load([{ _type: "image", _key: "i", asset: { url: "asset-url" } }], { factories: imageFactory });
    load([{ _type: "image", _key: "i2", url: 42, alt: 1, width: "wide", height: 3 }], {
      factories: imageFactory,
    });
    expect(calls[0]).toEqual({
      url: "asset-url",
      alt: undefined,
      title: undefined,
      caption: undefined,
      width: undefined,
      height: undefined,
    });
    expect(calls[1]).toMatchObject({ url: undefined, alt: undefined, height: 3 });
  });

  it("horizontal rule: empty without a factory, and never falls through to object", () => {
    const withoutFactory = load([{ _type: "hr", _key: "h" }], {
      factories: {
        text: factories.text,
        paragraph: factories.paragraph,
        object: () => factories.text("should not be used", 0),
      },
    });
    expect(withoutFactory.types).toEqual([]);
    expect(withoutFactory.missing).toEqual([]);

    const withFactory = load([{ _type: "hr", _key: "h" }], {
      factories: {
        text: factories.text,
        paragraph: factories.paragraph,
        horizontalRule: () => factories.text("rule", 0),
      },
    });
    expect(withFactory.text).toBe("rule");
  });
});

describe("robustness — portableTextToPlainText", () => {
  it("skips values that are not block objects", () => {
    expect(portableTextToPlainText([null, undefined, "nope", 42] as never)).toBe("");
  });

  it("a childless text block contributes an empty part", () => {
    expect(portableTextToPlainText([{ _type: "block" }] as never)).toBe("");
    // Two empty parts still join with the separator; harmless for indexing,
    // and pinned here so a change to it is deliberate.
    expect(portableTextToPlainText([{ _type: "block" }, { _type: "block" }] as never)).toBe("\n\n");
  });

  it("ignores non-span children, empty spans and mistyped text", () => {
    const blocks = [
      {
        _type: "block",
        _key: "b",
        style: "normal",
        children: [
          { _type: "span", _key: "s1", text: "kept", marks: [] },
          { _type: "mention", _key: "m" },
          { _type: "span", _key: "s2", text: "", marks: [] },
          { _type: "span", _key: "s3", text: 42, marks: [] },
          null,
        ],
      },
    ];
    expect(portableTextToPlainText(blocks as never)).toBe("kept");
  });

  it("respects includeCode and includeTables", () => {
    const blocks = [
      { _type: "code", _key: "c", code: "const a = 1;" },
      { _type: "table", _key: "t", rows: [{ cells: ["a", "b"] }, { cells: ["c"] }] },
    ];
    expect(portableTextToPlainText(blocks as never)).toBe("const a = 1;\n\na\tb\nc");
    expect(portableTextToPlainText(blocks as never, { includeCode: false })).toBe("a\tb\nc");
    expect(portableTextToPlainText(blocks as never, { includeTables: false })).toBe("const a = 1;");
    expect(
      portableTextToPlainText(blocks as never, { includeCode: false, includeTables: false }),
    ).toBe("");
  });

  it("drops empty code and empty table rows", () => {
    expect(portableTextToPlainText([{ _type: "code", _key: "c", code: "" }] as never)).toBe("");
    expect(portableTextToPlainText([{ _type: "code", _key: "c" }] as never)).toBe("");
    expect(portableTextToPlainText([{ _type: "table", _key: "t" }] as never)).toBe("");
    expect(
      portableTextToPlainText([{ _type: "table", _key: "t", rows: [{}, { cells: [] }] }] as never),
    ).toBe("");
  });

  it("honours a custom block separator", () => {
    const blocks = [
      {
        _type: "block",
        _key: "a",
        style: "normal",
        children: [{ _type: "span", _key: "s", text: "one", marks: [] }],
      },
      {
        _type: "block",
        _key: "b",
        style: "normal",
        children: [{ _type: "span", _key: "s2", text: "two", marks: [] }],
      },
    ];
    expect(portableTextToPlainText(blocks as never, { blockSeparator: " | " })).toBe("one | two");
  });
});
