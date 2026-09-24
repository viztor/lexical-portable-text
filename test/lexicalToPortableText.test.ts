import { describe, expect, it } from "vitest";

import {
  LEXICAL_FORMAT,
  lexicalToPortableText,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import {
  code,
  counterKeys,
  emptyState,
  heading,
  horizontalRule,
  link,
  linebreak,
  list,
  listItem,
  paragraph,
  quote,
  state,
  text,
} from "./helpers.js";

const spans = (block: PortableTextContent | undefined): PortableTextSpan[] =>
  (block as { children?: PortableTextSpan[] } | undefined)?.children ?? [];

describe("lexicalToPortableText — blocks and styles", () => {
  it("converts a paragraph and allocates the block key before span keys", () => {
    const blocks = lexicalToPortableText(state(paragraph(text("Hello"))), {
      keyGenerator: counterKeys(),
    });

    expect(blocks).toEqual([
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [{ _type: "span", _key: "k2", text: "Hello", marks: [] }],
      },
    ]);
  });

  it.each(["h1", "h2", "h3", "h4", "h5", "h6"])(
    "maps a %s heading to its Portable Text style",
    (tag) => {
      const [block] = lexicalToPortableText(state(heading(tag, text("Title"))), {
        keyGenerator: counterKeys(),
      });
      expect(block).toMatchObject({ style: tag });
    },
  );

  it("falls back to h2 for an unknown or missing heading tag", () => {
    const blocks = lexicalToPortableText(
      state(heading("h9", text("A")), { type: "heading", version: 1, children: [text("B")] }),
      { keyGenerator: counterKeys() },
    );
    expect(blocks.map((block) => (block as { style?: string }).style)).toEqual(["h2", "h2"]);
  });

  it("maps quotes to blockquote blocks", () => {
    const [block] = lexicalToPortableText(state(quote(text("Quoted"))), {
      keyGenerator: counterKeys(),
    });
    expect(block).toMatchObject({ style: "blockquote" });
  });

  it.each(["hr", "horizontalrule"])("maps a %s node to a horizontal-rule object", (type) => {
    const [block] = lexicalToPortableText(state(horizontalRule(type)), {
      keyGenerator: counterKeys(),
    });
    expect(block).toEqual({ _type: "horizontal-rule", _key: "k1" });
  });

  it("returns no blocks for an empty root or a root without children", () => {
    expect(lexicalToPortableText(state(), { keyGenerator: counterKeys() })).toEqual([]);
    expect(lexicalToPortableText(emptyState(), { keyGenerator: counterKeys() })).toEqual([]);
  });

  it("emits an empty block for an empty paragraph", () => {
    const [block] = lexicalToPortableText(state(paragraph()), {
      keyGenerator: counterKeys(),
    });
    expect(block).toMatchObject({ _type: "block", children: [] });
  });

  it("drops empty text nodes", () => {
    const [block] = lexicalToPortableText(state(paragraph(text(""), text("kept"), text(""))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)).toMatchObject([{ text: "kept" }]);
  });
});

describe("lexicalToPortableText — inline marks", () => {
  it("maps every default decorator", () => {
    const format =
      LEXICAL_FORMAT.bold |
      LEXICAL_FORMAT.italic |
      LEXICAL_FORMAT.strikethrough |
      LEXICAL_FORMAT.underline |
      LEXICAL_FORMAT.code;
    const [block] = lexicalToPortableText(state(paragraph(text("all", format))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]?.marks).toEqual(["strong", "em", "strike-through", "underline", "code"]);
  });

  it("drops sub/sup/highlight by default and reports them", () => {
    const dropped: string[] = [];
    const [block] = lexicalToPortableText(
      state(paragraph(text("x", LEXICAL_FORMAT.subscript | LEXICAL_FORMAT.highlight))),
      {
        keyGenerator: counterKeys(),
        onUnmapped: (decorator) => dropped.push(decorator),
      },
    );
    expect(spans(block)[0]?.marks).toEqual([]);
    expect(dropped).toEqual(["subscript", "highlight"]);
  });

  it("supports custom mark names", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("b", LEXICAL_FORMAT.bold))), {
      keyGenerator: counterKeys(),
      names: { bold: "b" },
    });
    expect(spans(block)[0]?.marks).toEqual(["b"]);
  });

  it("merges adjacent spans carrying identical marks", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(text("bold ", LEXICAL_FORMAT.bold), text("still bold", LEXICAL_FORMAT.bold))),
      { keyGenerator: counterKeys() },
    );
    const list = spans(block);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: "bold still bold", marks: ["strong"] });
  });

  it("does not merge spans with different marks", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(text("a", LEXICAL_FORMAT.bold), text("b", LEXICAL_FORMAT.italic))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toHaveLength(2);
  });

  it("ignores unknown format bits", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("x", 1024 | LEXICAL_FORMAT.bold))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]?.marks).toEqual(["strong"]);
  });
});

describe("lexicalToPortableText — links", () => {
  it("creates a link mark definition and references it from the span", () => {
    const blocks = lexicalToPortableText(
      state(paragraph(text("see "), link("https://x.dev", text("docs")))),
      { keyGenerator: counterKeys() },
    );

    expect(blocks).toEqual([
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        children: [
          { _type: "span", _key: "k2", text: "see ", marks: [] },
          { _type: "span", _key: "k4", text: "docs", marks: ["k3"] },
        ],
        markDefs: [{ _type: "link", _key: "k3", href: "https://x.dev" }],
      },
    ]);
  });

  it("keeps multiple links distinct", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph(link("https://a.dev", text("A")), text(" / "), link("https://b.dev", text("B"))),
      ),
      { keyGenerator: counterKeys() },
    );

    const definitions = (block as { markDefs?: Array<{ href: string }> }).markDefs;
    expect(definitions?.map((def) => def.href)).toEqual(["https://a.dev", "https://b.dev"]);
    expect(spans(block).map((span) => span.marks?.length ?? 0)).toEqual([1, 0, 1]);
  });

  it("carries decorators through linked text", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(link("https://x.dev", text("bold link", LEXICAL_FORMAT.bold)))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)[0]?.marks).toEqual(["k2", "strong"]);
  });

  it("tolerates a missing link URL", () => {
    const [block] = lexicalToPortableText(
      state(paragraph({ type: "link", version: 1, children: [text("x")] })),
      { keyGenerator: counterKeys() },
    );
    expect(block).toMatchObject({
      markDefs: [{ _type: "link", href: undefined }],
    });
  });

  it("converts autolink node to link mark definition", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph({
          type: "autolink",
          version: 1,
          url: "https://auto.dev",
          children: [text("https://auto.dev")],
        }),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(block).toMatchObject({
      markDefs: [{ _type: "link", href: "https://auto.dev" }],
      children: [{ text: "https://auto.dev", marks: ["k2"] }],
    });
  });

  it("preserves title, target, and rel on links", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph({
          type: "link",
          version: 1,
          url: "https://example.com",
          title: "Tooltip",
          target: "_blank",
          rel: "noopener",
          children: [text("Link with meta")],
        }),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(block).toMatchObject({
      markDefs: [
        {
          _type: "link",
          href: "https://example.com",
          title: "Tooltip",
          target: "_blank",
          rel: "noopener",
        },
      ],
    });
  });
});

describe("lexicalToPortableText — linebreaks", () => {
  it("folds a break into the surrounding span when marks match", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("one"), linebreak(), text("two"))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)).toMatchObject([{ text: "one\ntwo", marks: [] }]);
  });

  it("merges a leading break with the following text", () => {
    const [block] = lexicalToPortableText(state(paragraph(linebreak(), text("after"))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)).toMatchObject([{ text: "\nafter", marks: [] }]);
  });

  it("keeps consecutive breaks", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(text("a"), linebreak(), linebreak(), text("b"))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toMatchObject([{ text: "a\n\nb" }]);
  });

  it("keeps a break after a link outside the linked span", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(link("https://x.dev", text("docs")), linebreak(), text("after"))),
      { keyGenerator: counterKeys() },
    );
    const list = spans(block);
    expect(list).toHaveLength(2);
    expect(list[0]?.marks).toEqual(["k2"]);
    expect(list[1]).toMatchObject({ text: "\nafter", marks: [] });
  });

  it("appends a trailing break to the last span", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("end"), linebreak())), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]?.text).toBe("end\n");
  });
});

describe("lexicalToPortableText — lists", () => {
  it("converts a bullet list", () => {
    const blocks = lexicalToPortableText(
      state(list("bullet", listItem(text("One")), listItem(text("Two")))),
      { keyGenerator: counterKeys() },
    );
    expect(blocks).toMatchObject([
      { _type: "block", listItem: "bullet", level: 1, children: [{ text: "One" }] },
      { _type: "block", listItem: "bullet", level: 1, children: [{ text: "Two" }] },
    ]);
  });

  it("converts an ordered list", () => {
    const blocks = lexicalToPortableText(state(list("number", listItem(text("First")))), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toMatchObject([{ _type: "block", listItem: "number" }]);
  });

  it("maps check lists to bullet items (no PT task list standard)", () => {
    const blocks = lexicalToPortableText(state(list("check", listItem(text("Done")))), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toMatchObject([{ _type: "block", listItem: "bullet" }]);
  });

  it("maps check lists to check items with checked boolean when checkListMapping is check", () => {
    const blocks = lexicalToPortableText(
      state(
        list(
          "check",
          { type: "listitem", version: 1, value: 1, checked: true, children: [text("Done")] },
          { type: "listitem", version: 1, value: 2, checked: false, children: [text("Pending")] },
        ),
      ),
      { keyGenerator: counterKeys(), checkListMapping: "check" },
    );
    expect(blocks).toMatchObject([
      { _type: "block", listItem: "check", checked: true, children: [{ text: "Done" }] },
      { _type: "block", listItem: "check", checked: false, children: [{ text: "Pending" }] },
    ]);
  });

  it("emits nested levels for nested lists", () => {
    const blocks = lexicalToPortableText(
      state(
        list(
          "bullet",
          listItem(text("One")),
          listItem(text("Two"), list("bullet", listItem(text("Deep")))),
        ),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(blocks).toMatchObject([
      { listItem: "bullet", level: 1 },
      { listItem: "bullet", level: 1 },
      { listItem: "bullet", level: 2, children: [{ text: "Deep" }] },
    ]);
  });

  it("handles three levels", () => {
    const blocks = lexicalToPortableText(
      state(
        list(
          "bullet",
          listItem(
            text("L1"),
            list("bullet", listItem(text("L2"), list("bullet", listItem(text("L3"))))),
          ),
        ),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(blocks.map((block) => (block as { level?: number }).level)).toEqual([1, 2, 3]);
  });

  it("flattens paragraph children inside list items", () => {
    const blocks = lexicalToPortableText(
      state(list("bullet", listItem(paragraph(text("Wrapped"))))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(blocks[0])[0]?.text).toBe("Wrapped");
  });

  it("keeps marks inside list items", () => {
    const blocks = lexicalToPortableText(
      state(list("bullet", listItem(text("bold", LEXICAL_FORMAT.bold)))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(blocks[0])[0]?.marks).toEqual(["strong"]);
  });

  it("produces nothing for an empty list", () => {
    expect(lexicalToPortableText(state(list("bullet")), { keyGenerator: counterKeys() })).toEqual(
      [],
    );
  });

  it("skips non-listitem children of a list defensively", () => {
    const blocks = lexicalToPortableText(
      state(list("bullet", paragraph(text("loose")), listItem(text("item")))),
      { keyGenerator: counterKeys() },
    );
    expect(blocks.some((block) => spans(block).some((span) => span.text === "loose"))).toBe(true);
    expect(blocks.some((block) => (block as { listItem?: string }).listItem === "bullet")).toBe(
      true,
    );
  });
});

describe("lexicalToPortableText — code", () => {
  it("converts a code block with language", () => {
    const [block] = lexicalToPortableText(state(code("ts", "const a = 1;")), {
      keyGenerator: counterKeys(),
    });
    expect(block).toEqual({
      _type: "code",
      _key: "k1",
      language: "ts",
      code: "const a = 1;",
    });
  });

  it("keeps multiline code and a null language", () => {
    const [block] = lexicalToPortableText(state(code(null, "line one\nline two\n")), {
      keyGenerator: counterKeys(),
    });
    expect(block).toMatchObject({
      language: null,
      code: "line one\nline two\n",
    });
  });

  it("walks nested children when collecting code text", () => {
    const [block] = lexicalToPortableText(
      state({
        type: "code",
        version: 1,
        language: "js",
        children: [
          {
            type: "code-wrapper",
            version: 1,
            children: [{ type: "code-highlight", version: 1, text: "nested()" }],
          },
        ],
      }),
      { keyGenerator: counterKeys() },
    );
    expect(block).toMatchObject({ code: "nested()" });
  });
});

describe("lexicalToPortableText — unknown nodes", () => {
  const unknown = {
    type: "callout",
    version: 1,
    children: [paragraph(text("Inside"))],
  };

  it("salvages children by default", () => {
    const blocks = lexicalToPortableText(state(unknown as never), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(1);
    expect(spans(blocks[0])[0]?.text).toBe("Inside");
  });

  it("can skip", () => {
    expect(
      lexicalToPortableText(state(unknown as never), {
        keyGenerator: counterKeys(),
        onUnknownNode: "skip",
      }),
    ).toEqual([]);
  });

  it("can throw with the offending node type", () => {
    expect(() =>
      lexicalToPortableText(state(unknown as never), {
        onUnknownNode: "throw",
      }),
    ).toThrow(/callout/);
  });

  it("drops unknown leaf nodes that have no children", () => {
    expect(
      lexicalToPortableText(state({ type: "divider", version: 1 } as never), {
        keyGenerator: counterKeys(),
      }),
    ).toEqual([]);
  });

  it("salvages text from unknown inline nodes", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph({
          type: "mention",
          version: 1,
          children: [text("@sarah")],
        } as never),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)[0]?.text).toBe("@sarah");
  });
});

describe("lexicalToPortableText — rules", () => {
  const callout = {
    type: "callout",
    version: 1,
    tone: "warning",
    children: [paragraph(text("Careful"))],
  };

  it("uses a rule and receives the key generator + options", () => {
    const blocks = lexicalToPortableText(state(callout as never), {
      keyGenerator: counterKeys(),
      rules: [
        {
          type: "callout",
          toPortableText: (node, context) => ({
            _type: "callout",
            _key: context.key(),
            tone: (node as { tone?: string }).tone ?? "note",
            content: context.convertBlocks((node as { children?: never[] }).children ?? []),
          }),
        },
      ],
    });

    expect(blocks).toMatchObject([
      {
        _type: "callout",
        _key: "k1",
        tone: "warning",
        content: [{ _type: "block", children: [{ text: "Careful" }] }],
      },
    ]);
  });

  it("supports rules returning an array of blocks", () => {
    const blocks = lexicalToPortableText(state(callout as never), {
      keyGenerator: counterKeys(),
      rules: [
        {
          type: "callout",
          toPortableText: (_node, context) => [
            { _type: "callout", _key: context.key(), tone: "warning" },
            context.convertBlocks([paragraph(text("Body"))])[0] as PortableTextContent,
          ],
        },
      ],
    });
    expect(blocks.map((block) => block._type)).toEqual(["callout", "block"]);
  });

  it("delegates to default handling when a rule returns null", () => {
    const blocks = lexicalToPortableText(state(callout as never), {
      keyGenerator: counterKeys(),
      rules: [{ type: "callout", toPortableText: () => null }],
    });
    expect(blocks[0]).toMatchObject({ _type: "block" });
  });

  it("supports inline rules producing custom inline objects", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(text("See "), { type: "badge", version: 1, label: "NEW" }, text(" feature"))),
      {
        keyGenerator: counterKeys(),
        rules: [
          {
            type: "badge",
            toPortableText: (node) => ({
              _type: "badge",
              label: (node as unknown as { label: string }).label,
            }),
          },
        ],
      },
    );
    expect((block as { children: unknown[] }).children).toEqual([
      { _type: "span", _key: "k2", text: "See ", marks: [] },
      { _type: "badge", _key: "k3", label: "NEW" },
      { _type: "span", _key: "k4", text: " feature", marks: [] },
    ]);
  });

  it("preserves format and indent on blocks when options are enabled", () => {
    const blocks = lexicalToPortableText(
      state({
        type: "paragraph",
        version: 1,
        format: "center",
        indent: 3,
        children: [text("Centered")],
      }),
      {
        keyGenerator: counterKeys(),
        preserveFormat: true,
        preserveIndent: true,
      },
    );
    expect(blocks[0]).toMatchObject({
      style: "normal",
      format: "center",
      indent: 3,
    });
  });

  it("converts tables to standard portable text table blocks", () => {
    const [block] = lexicalToPortableText(
      state({
        type: "table",
        version: 1,
        children: [
          {
            type: "tablerow",
            version: 1,
            children: [
              { type: "tablecell", version: 1, children: [text("A1")] },
              { type: "tablecell", version: 1, children: [text("B1")] },
            ],
          },
        ],
      }),
      { keyGenerator: counterKeys() },
    );
    expect(block).toEqual({
      _type: "table",
      _key: "k1",
      rows: [
        {
          _type: "tableRow",
          _key: "k2",
          cells: ["A1", "B1"],
        },
      ],
    });
  });
});

describe("lexicalToPortableText — input forms", () => {
  it("accepts an editor-like instance", () => {
    const editor = {
      getEditorState: () => ({
        toJSON: () => state(paragraph(text("From editor"))),
      }),
    };
    const blocks = lexicalToPortableText(editor, { keyGenerator: counterKeys() });
    expect(spans(blocks[0])[0]?.text).toBe("From editor");
  });

  it("uses the default random key generator when none is provided", () => {
    const blocks = lexicalToPortableText(state(paragraph(text("x"))));
    expect((blocks[0] as { _key: string })._key).toMatch(/^[a-z0-9]{12}$/);
    expect(spans(blocks[0])[0]?._key).toMatch(/^[a-z0-9]{12}$/);
  });
});
