import { $createCodeNode } from "@lexical/code";
import { $createLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createHeadingNode } from "@lexical/rich-text";
import { $createTextNode } from "lexical";
import { describe, expect, it, vi } from "vitest";

import {
  LEXICAL_FORMAT,
  lexicalToPortableText,
  portableTextToLexical,
  portableTextToLexicalNodes,
  type HeadingTag,
  type LexicalNodeFactories,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import { childAt, collect, factories, makeEditor, rootChildren, textOf } from "./helpers.js";

let counter = 0;
const key = (): string => `e${(counter += 1)}`;
const span = (text: string, marks: string[] = []): PortableTextSpan => ({
  _type: "span",
  _key: key(),
  text,
  marks,
});
const textBlock = (
  children: PortableTextSpan[],
  extra: Partial<PortableTextBlock> = {},
): PortableTextBlock => ({
  _type: "block",
  _key: key(),
  style: "normal",
  children,
  ...extra,
});

describe("load — text fidelity", () => {
  it("preserves emoji, CJK and RTL through a round trip", () => {
    const value = "👋 你好 مرحبا";
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span(value)])], { factories });
    expect(textOf(childAt(editor, 0))).toBe(value);
    const [block] = lexicalToPortableText(editor);
    expect((block as { children: PortableTextSpan[] }).children[0]?.text).toBe(value);
  });

  it("ignores empty span text", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span(""), span("kept"), span("")])], { factories });
    expect(collect(childAt(editor, 0), "text")).toHaveLength(1);
    expect(textOf(childAt(editor, 0))).toBe("kept");
  });

  it("turns a newline-only span into a single linebreak", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("\n")])], { factories });
    expect(collect(childAt(editor, 0), "linebreak")).toHaveLength(1);
    expect(collect(childAt(editor, 0), "text")).toHaveLength(0);
  });

  it("skips spans with non-string text", () => {
    const editor = makeEditor();
    const malformed = { _type: "span", _key: key(), text: 7 } as unknown as PortableTextSpan;
    portableTextToLexical(editor, [textBlock([malformed, span("ok")])], { factories });
    expect(textOf(childAt(editor, 0))).toBe("ok");
  });
});

describe("load — factories receive the right arguments", () => {
  it("captures every factory call", () => {
    const calls = {
      text: [] as Array<[string, number]>,
      links: [] as string[],
      codes: [] as Array<string | null>,
      listItems: [] as Array<{ checked?: boolean }>,
      headings: [] as HeadingTag[],
      lists: [] as string[],
    };

    const capturing: LexicalNodeFactories = {
      text: (value, format) => {
        calls.text.push([value, format]);
        return $createTextNode(value).setFormat(format);
      },
      paragraph: (children) => factories.paragraph(children),
      linebreak: () => factories.linebreak!(),
      heading: (tag, children) => {
        calls.headings.push(tag);
        return $createHeadingNode(tag).append(...children);
      },
      list: (listType, children) => {
        calls.lists.push(listType);
        return $createListNode(listType).append(...children);
      },
      listItem: (children, meta) => {
        calls.listItems.push(meta);
        return $createListItemNode(meta.checked).append(...children);
      },
      code: (language, children) => {
        calls.codes.push(language);
        return $createCodeNode(language ?? undefined).append(...children);
      },
      link: (url, children) => {
        calls.links.push(url);
        return $createLinkNode(url).append(...children);
      },
    };

    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("bold", ["strong"]), span("plain")]),
        textBlock([span("see"), span("docs", ["l1"])], {
          markDefs: [{ _type: "link", _key: "l1", href: "https://x.dev" }],
        }),
        { _type: "code", _key: key(), language: "ts", code: "x()" },
        textBlock([span("H")], { style: "h3" }),
        textBlock([span("One")], {
          listItem: "check",
          level: 1,
          checked: true,
        } as Partial<PortableTextBlock>),
      ],
      { factories: capturing },
    );

    expect(calls.text).toEqual([
      ["bold", LEXICAL_FORMAT.bold],
      ["plain", 0],
      ["see", 0],
      ["docs", 0],
      ["x()", 0],
      ["H", 0],
      ["One", 0],
    ]);
    expect(calls.links).toEqual(["https://x.dev"]);
    expect(calls.codes).toEqual(["ts"]);
    expect(calls.headings).toEqual(["h3"]);
    expect(calls.lists).toEqual(["check"]);
    expect(calls.listItems).toEqual([{ checked: true }]);
  });

  it("passes checked: false through to the listItem factory", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [textBlock([span("Todo")], { listItem: "check", level: 1 } as Partial<PortableTextBlock>)],
      { factories },
    );
    expect(collect(childAt(editor, 0), "listitem")[0]).toMatchObject({
      checked: false,
    });
  });
});

describe("load — text node granularity", () => {
  it("normalizes separate same-mark spans into one Lexical text node", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("a", ["strong"]), span("b", ["strong"])])], {
      factories,
    });
    // Lexical merges adjacent identically-formatted text nodes itself, so the
    // load normalizes and the save merges back to a single span.
    expect(collect(childAt(editor, 0), "text")).toHaveLength(1);

    // Saving merges them back into one span — the round trip is value-stable.
    const [block] = lexicalToPortableText(editor);
    expect((block as { children: PortableTextSpan[] }).children).toMatchObject([
      { text: "ab", marks: ["strong"] },
    ]);
  });

  it("uses the object factory for inline objects", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([
          span("hi "),
          { _type: "emoji", _key: key(), value: "🎉" } as unknown as PortableTextSpan,
        ]),
      ],
      {
        factories: {
          ...factories,
          object: (block) =>
            block._type === "emoji" ? $createTextNode(String(block.value)) : null,
        },
      },
    );
    expect(textOf(childAt(editor, 0))).toBe("hi 🎉");
  });
});

describe("load — list levels", () => {
  it("returns to the outer list when the level decreases", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("A")], { listItem: "bullet", level: 1 }),
        textBlock([span("B")], { listItem: "bullet", level: 2 }),
        textBlock([span("C")], { listItem: "bullet", level: 1 }),
      ],
      { factories },
    );

    const lists = collect(childAt(editor, 0), "list");
    const topItems = (childAt(editor, 0)?.children ?? []) as Array<{
      type: string;
    }>;
    expect(lists).toHaveLength(2);
    expect(topItems).toHaveLength(2);
    const nested = collect(topItems[0], "list");
    expect(nested).toHaveLength(1);
  });

  it("handles level 0 as a top-level list", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("Zero")], { listItem: "bullet", level: 0 })], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({
      type: "list",
      listType: "bullet",
    });
  });

  it("compresses skipped levels when saving (1,3 → 1,2)", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("One")], { listItem: "bullet", level: 1 }),
        textBlock([span("Deep")], { listItem: "bullet", level: 3 }),
      ],
      { factories },
    );
    const flattened = lexicalToPortableText(editor) as PortableTextContent[];
    expect(flattened.map((block) => (block as { level?: number }).level)).toEqual([1, 2]);
  });

  it("builds one hundred list items", () => {
    const editor = makeEditor();
    const blocks = Array.from({ length: 100 }, (_, index) =>
      textBlock([span(`Item ${index}`)], { listItem: "bullet", level: 1 }),
    );
    portableTextToLexical(editor, blocks, { factories });
    expect(collect(childAt(editor, 0), "listitem")).toHaveLength(100);
  });

  it("assigns sequential values to ordered list items", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("First")], { listItem: "number", level: 1 }),
        textBlock([span("Second")], { listItem: "number", level: 1 }),
        textBlock([span("Third")], { listItem: "number", level: 1 }),
      ],
      { factories },
    );
    expect(collect(childAt(editor, 0), "listitem").map((item) => item.value)).toEqual([1, 2, 3]);
  });
});

describe("load — objects and rules", () => {
  it("propagates errors thrown by rules", () => {
    const editor = makeEditor();
    expect(() =>
      portableTextToLexical(editor, [{ _type: "callout", _key: key() }], {
        factories,
        rules: [
          {
            type: "callout",
            toLexical: () => {
              throw new Error("rule exploded");
            },
          },
        ],
      }),
    ).toThrow("rule exploded");
  });

  it("passes the whole object block to the object factory", () => {
    const received: Array<Record<string, unknown>> = [];
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "callout", _key: key(), tone: "warning", extra: 42 }], {
      factories: {
        ...factories,
        object: (block) => {
          received.push(block as unknown as Record<string, unknown>);
          return factories.paragraph([]);
        },
      },
    });
    expect(received[0]).toMatchObject({ _type: "callout", tone: "warning", extra: 42 });
  });

  it("builds links with an empty href without crashing", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("x", ["l1"])], {
          markDefs: [{ _type: "link", _key: "l1", href: "" }],
        }),
      ],
      { factories },
    );
    expect(collect(childAt(editor, 0), "link")[0]).toMatchObject({ url: "" });
  });

  it("does not mutate the input blocks", () => {
    const blocks = [
      textBlock([span("see"), span("docs", ["l1"])], {
        markDefs: [{ _type: "link", _key: "l1", href: "https://x.dev" }],
      }),
      textBlock([span("One")], { listItem: "bullet", level: 1 }),
    ];
    const snapshot = JSON.stringify(blocks);
    const editor = makeEditor();
    portableTextToLexical(editor, blocks, { factories });
    expect(JSON.stringify(blocks)).toBe(snapshot);
  });

  it("reports which factory kinds were missing", () => {
    const onMissingFactory = vi.fn();
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("H")], { style: "h1" }),
        { _type: "code", _key: key(), language: null, code: "x" },
      ],
      {
        factories: {
          text: factories.text,
          paragraph: factories.paragraph,
        },
        onMissingFactory,
      },
    );
    expect(onMissingFactory.mock.calls.map((call) => call[0])).toEqual(["heading", "code"]);
    expect(rootChildren(editor)).toHaveLength(2);
  });
});

describe("load — editor isolation and $ context discipline", () => {
  it("keeps two editors independent", () => {
    const first = makeEditor();
    const second = makeEditor();
    portableTextToLexical(first, [textBlock([span("first editor")])], {
      factories,
    });
    portableTextToLexical(second, [textBlock([span("second editor")])], {
      factories,
    });
    expect(textOf(childAt(first, 0))).toBe("first editor");
    expect(textOf(childAt(second, 0))).toBe("second editor");

    portableTextToLexical(second, [textBlock([span("rewritten")])], {
      factories,
    });
    expect(textOf(childAt(first, 0))).toBe("first editor");
    expect(textOf(childAt(second, 0))).toBe("rewritten");
  });

  it("requires an active $ context for portableTextToLexicalNodes", () => {
    expect(() =>
      portableTextToLexicalNodes([textBlock([span("outside")])], {
        factories,
      }),
    ).toThrow(/active editor state|update|read/i);
  });
});
