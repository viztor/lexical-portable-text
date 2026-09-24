import { $createParagraphNode, $createTextNode, $getRoot, type LexicalNode } from "lexical";
import { describe, expect, it, vi } from "vitest";

import {
  LEXICAL_FORMAT,
  portableTextToLexical,
  portableTextToLexicalNodes,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import {
  childAt,
  collect,
  factories,
  makeEditor,
  minimalFactories,
  rootChildren,
  textOf,
} from "./helpers.js";

let keyCounter = 0;
const key = (): string => `p${(keyCounter += 1)}`;
const span = (value: string, marks: string[] = []): PortableTextSpan => ({
  _type: "span",
  _key: key(),
  text: value,
  marks,
});
const textBlock = (
  children: PortableTextBlock["children"],
  extra: Partial<PortableTextBlock> = {},
): PortableTextBlock => ({
  _type: "block",
  _key: key(),
  style: "normal",
  children,
  ...extra,
});

describe("portableTextToLexical — blocks", () => {
  it("builds paragraphs with text formats", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [textBlock([span("Hello "), span("bold", ["strong"]), span("code", ["code"])])],
      { factories },
    );

    const paragraph = childAt(editor, 0);
    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(
      ((paragraph?.children ?? []) as Array<{ text: string; format: number }>).map((node) => ({
        text: node.text,
        format: node.format,
      })),
    ).toEqual([
      { text: "Hello ", format: 0 },
      { text: "bold", format: LEXICAL_FORMAT.bold },
      { text: "code", format: LEXICAL_FORMAT.code },
    ]);
  });

  it("combines multiple marks into one bitmask", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("x", ["strong", "em", "underline"])])], {
      factories,
    });
    const textNode = collect(childAt(editor, 0), "text")[0];
    expect(textNode?.format).toBe(
      LEXICAL_FORMAT.bold | LEXICAL_FORMAT.italic | LEXICAL_FORMAT.underline,
    );
  });

  it.each(["h1", "h2", "h3", "h4", "h5", "h6"])("maps style %s to a heading tag", (tag) => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("T")], { style: tag })], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "heading", tag });
  });

  it("falls back to paragraph for unknown styles and reports it", () => {
    const editor = makeEditor();
    const onMissingFactory = vi.fn();
    portableTextToLexical(editor, [textBlock([span("T")], { style: "h9" })], {
      factories,
      onMissingFactory,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "paragraph" });
    expect(onMissingFactory).toHaveBeenCalledWith(
      "heading",
      expect.objectContaining({ style: "h9" }),
    );
  });

  it("builds quotes", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("Quoted")], { style: "blockquote" })], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "quote" });
  });

  it("supports custom block styles via rules", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("Subtitle text")], { style: "subtitle" })], {
      factories,
      rules: [
        {
          type: "subtitle",
          toLexical: (block) => {
            return factories.heading!("h3", [factories.text(textOf(block), 0)]);
          },
        },
      ],
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "heading", tag: "h3" });
    expect(textOf(childAt(editor, 0))).toBe("Subtitle text");
  });

  it("supports custom block styles via factories.blockStyle", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("Lead paragraph")], { style: "lead" })], {
      factories: {
        ...factories,
        blockStyle: (style, children) => {
          if (style === "lead") {
            return factories.paragraph(children);
          }
          return null;
        },
      },
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "paragraph" });
    expect(textOf(childAt(editor, 0))).toBe("Lead paragraph");
  });

  it("applies format and indent to the Lexical element node", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        {
          _type: "block",
          _key: "b1",
          style: "normal",
          format: "center",
          indent: 2,
          children: [span("Aligned")],
        } as PortableTextBlock & { format: string; indent: number },
      ],
      { factories },
    );
    expect(childAt(editor, 0)).toMatchObject({
      type: "paragraph",
      format: "center",
      indent: 2,
    });
  });

  it("replaces existing content on each call", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("first")])], { factories });
    portableTextToLexical(editor, [textBlock([span("second")])], { factories });
    expect(rootChildren(editor)).toHaveLength(1);
    expect(textOf(childAt(editor, 0))).toBe("second");
  });
});

describe("portableTextToLexical — inline", () => {
  it("reconstructs links from mark definitions", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("see "), span("docs", ["l1"])], {
          markDefs: [{ _type: "link", _key: "l1", href: "https://x.dev" }],
        }),
      ],
      { factories },
    );
    const linkNode = collect(childAt(editor, 0), "link")[0];
    expect(linkNode).toMatchObject({ url: "https://x.dev" });
    expect(textOf(linkNode)).toBe("docs");
  });

  it("supports multiple links in one block", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("A", ["l1"]), span(" / "), span("B", ["l2"])], {
          markDefs: [
            { _type: "link", _key: "l1", href: "https://a.dev" },
            { _type: "link", _key: "l2", href: "https://b.dev" },
          ],
        }),
      ],
      { factories },
    );
    const links = collect(childAt(editor, 0), "link");
    expect(links.map((node) => node.url)).toEqual(["https://a.dev", "https://b.dev"]);
  });

  it("falls back to text when a link mark definition is missing", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("orphan", ["missing"])])], { factories });
    expect(collect(childAt(editor, 0), "link")).toHaveLength(0);
    expect(textOf(childAt(editor, 0))).toBe("orphan");
  });

  it("drops non-link mark definitions without corrupting text", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("annotated", ["a1"])], {
          markDefs: [{ _type: "annotation", _key: "a1" }],
        }),
      ],
      { factories },
    );
    expect(textOf(childAt(editor, 0))).toBe("annotated");
    expect(collect(childAt(editor, 0), "text")[0]?.format).toBe(0);
  });

  it("handles custom mark definitions via annotationRules", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("commented text", ["c1"])], {
          markDefs: [{ _type: "comment", _key: "c1", commentId: "c_42" }],
        }),
      ],
      {
        factories,
        annotationRules: [
          {
            type: "comment",
            toLexical: (def, children) => {
              return factories.link!(
                `comment:${(def as unknown as { commentId: string }).commentId}`,
                children,
              );
            },
          },
        ],
      },
    );
    const linkNode = collect(childAt(editor, 0), "link")[0];
    expect(linkNode).toMatchObject({ type: "link", url: "comment:c_42" });
    expect(textOf(linkNode)).toBe("commented text");
  });

  it("handles custom mark definitions via factories.annotation fallback", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("footnote text", ["fn1"])], {
          markDefs: [{ _type: "footnote", _key: "fn1", note: "Source: 2024" }],
        }),
      ],
      {
        factories: {
          ...factories,
          annotation: (def, children) => {
            return factories.link!(
              `footnote:${(def as unknown as { note: string }).note}`,
              children,
            );
          },
        },
      },
    );
    const linkNode = collect(childAt(editor, 0), "link")[0];
    expect(linkNode).toMatchObject({ type: "link", url: "footnote:Source: 2024" });
  });

  it("forwards link metadata (title, target, rel) to factories.link", () => {
    const editor = makeEditor();
    const linkSpy = vi.fn(
      (
        url: string,
        children: LexicalNode[],
        meta?: { title?: string; target?: string; rel?: string },
      ) => {
        return factories.link!(url, children, meta);
      },
    );
    portableTextToLexical(
      editor,
      [
        textBlock([span("link with meta", ["l1"])], {
          markDefs: [
            {
              _type: "link",
              _key: "l1",
              href: "https://example.com",
              title: "Tooltip",
              target: "_blank",
              rel: "noopener",
            },
          ],
        }),
      ],
      {
        factories: {
          ...factories,
          link: linkSpy,
        },
      },
    );
    expect(linkSpy).toHaveBeenCalledWith("https://example.com", expect.anything(), {
      title: "Tooltip",
      target: "_blank",
      rel: "noopener",
    });
  });

  it("ignores unknown mark names", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("x", ["wat"])])], {
      factories,
    });
    expect(collect(childAt(editor, 0), "text")[0]?.format).toBe(0);
  });

  it("honors custom mark names", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("x", ["b"])])], {
      factories,
      names: { bold: "b" },
    });
    expect(collect(childAt(editor, 0), "text")[0]?.format).toBe(LEXICAL_FORMAT.bold);
  });

  it("tolerates spans without a marks property", () => {
    const editor = makeEditor();
    const bare = {
      _type: "span",
      _key: key(),
      text: "plain",
    } as unknown as PortableTextSpan;
    portableTextToLexical(editor, [textBlock([bare])], { factories });
    expect(textOf(childAt(editor, 0))).toBe("plain");
  });

  it("splits newlines into linebreak nodes", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("\na\n\nb\n")])], {
      factories,
    });
    const paragraph = childAt(editor, 0);
    expect(collect(paragraph, "linebreak")).toHaveLength(4);
    expect(textOf(paragraph)).toBe("\na\n\nb\n");
  });

  it("skips inline objects without a factory", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([
          span("before"),
          { _type: "emoji", _key: key() } as unknown as PortableTextSpan,
          span("after"),
        ]),
      ],
      { factories },
    );
    expect(textOf(childAt(editor, 0))).toBe("beforeafter");
  });
});

describe("portableTextToLexical — lists", () => {
  it("builds a single bullet list", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("One")], { listItem: "bullet", level: 1 })], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({
      type: "list",
      listType: "bullet",
    });
    expect(collect(childAt(editor, 0), "listitem")).toHaveLength(1);
  });

  it("builds ordered lists", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("First")], { listItem: "number", level: 1 })], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({ listType: "number" });
  });

  it("builds task lists and passes the checked flag", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("Done")], {
          listItem: "check",
          level: 1,
          checked: true,
        } as Partial<PortableTextBlock>),
      ],
      { factories },
    );
    expect(childAt(editor, 0)).toMatchObject({ listType: "check" });
    expect(collect(childAt(editor, 0), "listitem")[0]).toMatchObject({
      checked: true,
    });
  });

  it("nests lists three levels deep", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("L1")], { listItem: "bullet", level: 1 }),
        textBlock([span("L2")], { listItem: "bullet", level: 2 }),
        textBlock([span("L3")], { listItem: "bullet", level: 3 }),
      ],
      { factories },
    );
    expect(collect(childAt(editor, 0), "list")).toHaveLength(3);
  });

  it("keeps lists separate across paragraphs and type changes", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("One")], { listItem: "bullet", level: 1 }),
        textBlock([span("Two")], { listItem: "bullet", level: 1 }),
        textBlock([span("break")]),
        textBlock([span("First")], { listItem: "number", level: 1 }),
      ],
      { factories },
    );
    const children = rootChildren(editor);
    expect(children.map((node) => node.type)).toEqual(["list", "paragraph", "list"]);
    expect(children[0]).toMatchObject({ listType: "bullet" });
    expect(children[2]).toMatchObject({ listType: "number" });
  });

  it("splits a run when the list type changes at the same level", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("Bullet")], { listItem: "bullet", level: 1 }),
        textBlock([span("Number")], { listItem: "number", level: 1 }),
      ],
      { factories },
    );
    expect(rootChildren(editor).map((node) => node.type)).toEqual(["list", "list"]);
  });

  it("handles level skips by nesting under the previous item", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([span("One")], { listItem: "bullet", level: 1 }),
        textBlock([span("Deep")], { listItem: "number", level: 3 }),
      ],
      { factories },
    );
    const lists = collect(childAt(editor, 0), "list");
    expect(lists.map((node) => node.listType)).toEqual(["bullet", "number"]);
  });

  it("falls back to paragraphs without a list factory", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("One")], { listItem: "bullet", level: 1 })], {
      factories: minimalFactories,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "paragraph" });
    expect(textOf(childAt(editor, 0))).toBe("One");
  });

  it("falls back to paragraph items without a listItem factory (Lexical auto-wraps)", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("One")], { listItem: "bullet", level: 1 })], {
      factories: { ...minimalFactories, list: factories.list },
    });
    const items = collect(childAt(editor, 0), "listitem");
    expect(items).toHaveLength(1);
    expect(textOf(items[0])).toBe("One");
  });
});

describe("portableTextToLexical — code", () => {
  const codeBlock = (language: string | null, value: string): PortableTextContent => ({
    _type: "code",
    _key: key(),
    language,
    code: value,
  });

  it("builds code nodes with language", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [codeBlock("ts", "const a = 1;")], {
      factories,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "code", language: "ts" });
    expect(textOf(childAt(editor, 0))).toBe("const a = 1;");
  });

  it("keeps multiline code as linebreaks", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [codeBlock(null, "a\nb\n")], { factories });
    const codeNode = childAt(editor, 0);
    expect(codeNode).toMatchObject({ type: "code" });
    expect(codeNode?.language ?? null).toBeNull();
    expect(collect(codeNode, "linebreak")).toHaveLength(2);
    expect(textOf(codeNode)).toBe("a\nb\n");
  });

  it("forwards filename to factories.code", () => {
    const editor = makeEditor();
    const codeSpy = vi.fn(
      (lang: string | null, ch: LexicalNode[], meta?: { filename?: string }) => {
        return factories.code!(lang, ch, meta);
      },
    );
    portableTextToLexical(
      editor,
      [
        {
          _type: "code",
          _key: key(),
          language: "ts",
          filename: "main.ts",
          code: "const x = 1;",
        } as never,
      ],
      {
        factories: {
          ...factories,
          code: codeSpy,
        },
      },
    );
    expect(codeSpy).toHaveBeenCalledWith("ts", expect.anything(), { filename: "main.ts" });
  });

  it("falls back to a paragraph without a code factory and reports it", () => {
    const editor = makeEditor();
    const onMissingFactory = vi.fn();
    portableTextToLexical(editor, [codeBlock("ts", "x")], {
      factories: minimalFactories,
      onMissingFactory,
    });
    expect(childAt(editor, 0)).toMatchObject({ type: "paragraph" });
    expect(onMissingFactory).toHaveBeenCalledWith("code", expect.anything());
  });
});

describe("portableTextToLexical — object blocks", () => {
  it("creates horizontal rules when a factory exists", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "horizontal-rule", _key: key() }], {
      factories: {
        ...factories,
        // Stand-in node for the rule; the wiring is what's under test.
        horizontalRule: () => $createParagraphNode(),
      },
    });
    expect(rootChildren(editor)).toHaveLength(1);
  });

  it("skips horizontal rules without a factory", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "horizontal-rule", _key: key() }], {
      factories,
    });
    expect(rootChildren(editor)).toHaveLength(0);
  });

  it("skips unknown objects without a rule or factory", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "mystery", _key: key() }], {
      factories,
    });
    expect(rootChildren(editor)).toHaveLength(0);
  });

  it("uses rules for custom objects", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "callout", _key: key(), tone: "warning" }], {
      factories,
      rules: [
        {
          type: "callout",
          toLexical: (block) =>
            $createParagraphNode().append($createTextNode(`Callout: ${String(block.tone)}`)),
        },
      ],
    });
    expect(textOf(childAt(editor, 0))).toBe("Callout: warning");
  });

  it("supports rules returning multiple nodes", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "callout", _key: key() }], {
      factories,
      rules: [
        {
          type: "callout",
          toLexical: () => [
            $createParagraphNode().append($createTextNode("one")),
            $createParagraphNode().append($createTextNode("two")),
          ],
        },
      ],
    });
    expect(rootChildren(editor)).toHaveLength(2);
  });

  it("falls through to the object factory when a rule returns null", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "callout", _key: key() }], {
      factories: {
        ...factories,
        object: (block) =>
          block._type === "callout"
            ? $createParagraphNode().append($createTextNode("from factory"))
            : null,
      },
      rules: [{ type: "callout", toLexical: () => null }],
    });
    expect(textOf(childAt(editor, 0))).toBe("from factory");
  });

  it("supports object factories returning arrays", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [{ _type: "callout", _key: key() }], {
      factories: {
        ...factories,
        object: () => [
          $createParagraphNode().append($createTextNode("a")),
          $createParagraphNode().append($createTextNode("b")),
        ],
      },
    });
    expect(rootChildren(editor)).toHaveLength(2);
  });

  it("supports rules for inline objects within block children", () => {
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        textBlock([
          span("Hello "),
          { _type: "mention", _key: key(), handle: "alice" } as never,
          span("!"),
        ]),
      ],
      {
        factories,
        rules: [
          {
            type: "mention",
            toLexical: (block) =>
              $createTextNode(`@${String((block as { handle?: string }).handle)}`),
          },
        ],
      },
    );
    expect(textOf(childAt(editor, 0))).toBe("Hello @alice!");
  });

  it("builds table nodes from table blocks using table factories", () => {
    const editor = makeEditor();
    const tableSpy = vi.fn((rows: LexicalNode[]) => $createParagraphNode().append(...rows));
    const rowSpy = vi.fn((cells: LexicalNode[]) => $createParagraphNode().append(...cells));
    const cellSpy = vi.fn((children: LexicalNode[]) => $createParagraphNode().append(...children));

    portableTextToLexical(
      editor,
      [
        {
          _type: "table",
          _key: key(),
          rows: [{ _type: "tableRow", _key: key(), cells: ["Cell 1", "Cell 2"] }],
        } as never,
      ],
      {
        factories: {
          ...factories,
          table: tableSpy,
          tableRow: rowSpy,
          tableCell: cellSpy,
        },
      },
    );
    expect(tableSpy).toHaveBeenCalled();
    expect(rowSpy).toHaveBeenCalledTimes(1);
    expect(cellSpy).toHaveBeenCalledTimes(2);
  });
});

describe("portableTextToLexical — factory fallbacks", () => {
  it("falls back to paragraph when heading/quote factories are missing", () => {
    const editor = makeEditor();
    const onMissingFactory = vi.fn();
    portableTextToLexical(
      editor,
      [textBlock([span("H")], { style: "h2" }), textBlock([span("Q")], { style: "blockquote" })],
      { factories: minimalFactories, onMissingFactory },
    );
    expect(rootChildren(editor).map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    expect(onMissingFactory).toHaveBeenCalledTimes(2);
  });

  it("falls back to a text newline when no linebreak factory exists", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("a\nb")])], {
      factories: minimalFactories,
    });
    expect(textOf(childAt(editor, 0))).toBe("a\nb");
  });
});

describe("portableTextToLexical — API", () => {
  it("clears the root for an empty block array", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("first")])], { factories });
    portableTextToLexical(editor, [], { factories });
    expect(rootChildren(editor)).toHaveLength(0);
  });

  it("exposes $ context nodes for embedding inside an existing update", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append(
          ...portableTextToLexicalNodes([textBlock([span("inline")])], {
            factories,
          }),
        );
      },
      { discrete: true },
    );
    expect(textOf(childAt(editor, 0))).toBe("inline");
  });

  it("applies a discrete update so state is readable synchronously", () => {
    const editor = makeEditor();
    portableTextToLexical(editor, [textBlock([span("sync")])], { factories });
    expect(textOf(rootChildren(editor)[0])).toBe("sync");
  });
});
