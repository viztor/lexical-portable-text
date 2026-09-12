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
  heading,
  horizontalRule,
  link,
  linebreak,
  list,
  listItem,
  paragraph,
  state,
  text,
} from "./helpers.js";

const spans = (block: PortableTextContent | undefined): PortableTextSpan[] =>
  (block as { children?: PortableTextSpan[] } | undefined)?.children ?? [];

describe("save — text fidelity", () => {
  it("preserves emoji, CJK, RTL and combining characters", () => {
    const value = "👋 你好 مرحبا e\u0301 — ünïcødé";
    const [block] = lexicalToPortableText(state(paragraph(text(value))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]?.text).toBe(value);
  });

  it("preserves whitespace-only text", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("   "), text("\t"))), {
      keyGenerator: counterKeys(),
    });
    // Adjacent same-mark runs merge, so the two whitespace spans combine.
    expect(spans(block).map((span) => span.text)).toEqual(["   \t"]);
  });

  it("preserves long text without splitting", () => {
    const value = "x".repeat(20_000);
    const [block] = lexicalToPortableText(state(paragraph(text(value))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)).toHaveLength(1);
    expect(spans(block)[0]?.text).toHaveLength(20_000);
  });

  it("does not interpret markdown- or HTML-like characters", () => {
    const value = "**bold** <b>html</b> `code` & [link](url)";
    const [block] = lexicalToPortableText(state(paragraph(text(value))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]).toMatchObject({ text: value, marks: [] });
  });

  it("preserves CRLF sequences inside text", () => {
    const [block] = lexicalToPortableText(state(paragraph(text("a\r\nb"))), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)[0]?.text).toBe("a\r\nb");
  });

  it("skips malformed text nodes with a missing or non-string text", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph(
          { type: "text", version: 1, format: 0 } as never,
          { type: "text", version: 1, format: 0, text: 42 } as never,
          text("kept"),
        ),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toMatchObject([{ text: "kept" }]);
  });

  it("drops malformed inline nodes without children arrays", () => {
    const [block] = lexicalToPortableText(
      state(paragraph({ type: "mention", version: 1 } as never, text("kept"))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toMatchObject([{ text: "kept" }]);
  });

  it("treats a paragraph without a children array as empty", () => {
    const [block] = lexicalToPortableText(state({ type: "paragraph", version: 1 } as never), {
      keyGenerator: counterKeys(),
    });
    expect(block).toMatchObject({ _type: "block", children: [] });
  });
});

describe("save — ordering and composition", () => {
  it("preserves the interleaving of block types", () => {
    const blocks = lexicalToPortableText(
      state(
        code("ts", "const a = 1;"),
        paragraph(text("intro")),
        horizontalRule(),
        list("bullet", listItem(text("item"))),
        heading("h2", text("Section")),
        code(null, "last()"),
      ),
      { keyGenerator: counterKeys() },
    );

    expect(blocks.map((block) => block._type)).toEqual([
      "code",
      "block",
      "horizontal-rule",
      "block",
      "block",
      "code",
    ]);
    expect(spans(blocks[1])[0]?.text).toBe("intro");
    expect(spans(blocks[4])[0]?.text).toBe("Section");
    expect((blocks[4] as { style?: string }).style).toBe("h2");
  });

  it("dedupes identical link hrefs into one shared mark definition", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph(
          link("https://same.dev", text("first")),
          text(" "),
          link("https://same.dev", text("second")),
        ),
      ),
      { keyGenerator: counterKeys() },
    );

    const definitions = (block as { markDefs?: Array<{ href: string }> }).markDefs;
    expect(definitions).toHaveLength(1);
    expect(definitions?.[0]?.href).toBe("https://same.dev");
    // Both spans reference the same mark key.
    expect(spans(block)[0]?.marks).toEqual(spans(block)[2]?.marks);
  });

  it("keeps different link targets as distinct mark definitions", () => {
    const [block] = lexicalToPortableText(
      state(
        paragraph(link("https://a.dev", text("A")), text(" "), link("https://b.dev", text("B"))),
      ),
      { keyGenerator: counterKeys() },
    );

    const definitions = (block as { markDefs?: Array<{ href: string }> }).markDefs;
    expect(definitions?.map((definition) => definition.href)).toEqual([
      "https://a.dev",
      "https://b.dev",
    ]);
  });

  it("does not merge a link span with an identical plain span", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(link("https://x.dev", text("same")), text("same"))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toHaveLength(2);
    expect(spans(block)[0]?.marks).not.toEqual(spans(block)[1]?.marks);
  });

  it("does not merge two adjacent links", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(link("https://a.dev", text("A")), link("https://b.dev", text("B")))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toHaveLength(2);
  });

  it("folds a break into the preceding differently-marked run", () => {
    const [block] = lexicalToPortableText(
      state(paragraph(text("bold", LEXICAL_FORMAT.bold), linebreak(), text("plain"))),
      { keyGenerator: counterKeys() },
    );
    expect(spans(block)).toMatchObject([
      { text: "bold\n", marks: ["strong"] },
      { text: "plain", marks: [] },
    ]);
  });

  it("converts a paragraph containing only a break", () => {
    const [block] = lexicalToPortableText(state(paragraph(linebreak())), {
      keyGenerator: counterKeys(),
    });
    expect(spans(block)).toMatchObject([{ text: "\n", marks: [] }]);
  });

  it("keeps marks on list items and headings", () => {
    const blocks = lexicalToPortableText(
      state(
        heading("h3", text("T", LEXICAL_FORMAT.italic)),
        list("number", listItem(text("I", LEXICAL_FORMAT.bold))),
      ),
      { keyGenerator: counterKeys() },
    );
    expect(spans(blocks[0])[0]?.marks).toEqual(["em"]);
    expect(spans(blocks[1])[0]?.marks).toEqual(["strong"]);
  });
});

describe("save — options and rules", () => {
  it("resolves duplicate rule types with the later rule winning", () => {
    const callout = {
      type: "callout",
      version: 1,
      children: [paragraph(text("x"))],
    };
    const blocks = lexicalToPortableText(state(callout as never), {
      keyGenerator: counterKeys(),
      rules: [
        {
          type: "callout",
          toPortableText: (_node, context) => ({
            _type: "callout",
            _key: context.key(),
            tone: "first",
          }),
        },
        {
          type: "callout",
          toPortableText: (_node, context) => ({
            _type: "callout",
            _key: context.key(),
            tone: "second",
          }),
        },
      ],
    });
    expect(blocks[0]).toMatchObject({ tone: "second" });
  });

  it("continues the key sequence across conversions with a shared generator", () => {
    const keyGenerator = counterKeys();
    const first = lexicalToPortableText(state(paragraph(text("one"))), {
      keyGenerator,
    });
    const second = lexicalToPortableText(state(paragraph(text("two"))), {
      keyGenerator,
    });
    expect((first[0] as { _key: string })._key).toBe("k1");
    expect((second[0] as { _key: string })._key).toBe("k3");
  });

  it("does not mutate the input state", () => {
    const input = state(
      paragraph(text("x"), link("https://x.dev", text("y"))),
      heading("h2", text("t")),
    );
    const snapshot = JSON.stringify(input);
    lexicalToPortableText(input, { keyGenerator: counterKeys() });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
