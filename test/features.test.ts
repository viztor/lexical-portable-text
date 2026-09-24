import { describe, expect, it, vi } from "vitest";
import { $createParagraphNode, $createTextNode, type LexicalNode } from "lexical";
import { $createLinkNode } from "@lexical/link";

import {
  LEXICAL_FORMAT,
  lexicalToPortableText,
  portableTextToLexical,
  portableTextToPlainText,
  type ArbitraryTypedObject,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextImageBlock,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
  type PortableTextTableBlock,
} from "../src/index.js";
import {
  autolink,
  checkListItem,
  childAt,
  codeWithFilename,
  collect,
  counterKeys,
  factories,
  heading,
  linkWithMeta,
  list,
  makeEditor,
  paragraph,
  rootChildren,
  state,
  stripKeys,
  table,
  tableCell,
  tableRow,
  text,
  textOf,
} from "./helpers.js";

const spans = (block: PortableTextContent | undefined): PortableTextSpan[] =>
  (block as { children?: PortableTextSpan[] } | undefined)?.children ?? [];

describe("Feature: Checklists / Task lists", () => {
  it("preserves listItem: 'check' and checked: boolean when checkListMapping is 'check'", () => {
    const serialized = state(
      list(
        "check",
        checkListItem(false, text("Pending task")),
        checkListItem(true, text("Completed task")),
      ),
    );

    const blocks = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      checkListMapping: "check",
    });

    expect(blocks).toMatchObject([
      {
        _type: "block",
        listItem: "check",
        level: 1,
        checked: false,
        children: [{ text: "Pending task" }],
      },
      {
        _type: "block",
        listItem: "check",
        level: 1,
        checked: true,
        children: [{ text: "Completed task" }],
      },
    ]);
  });

  it("defaults to listItem: 'bullet' when checkListMapping is not specified (standard PT behavior)", () => {
    const serialized = state(list("check", checkListItem(true, text("Task"))));

    const blocks = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(blocks[0]).toMatchObject({
      _type: "block",
      listItem: "bullet",
      level: 1,
    });
    expect(blocks[0]).not.toHaveProperty("checked");
  });

  it("loads Portable Text check list items into Lexical list with listType 'check' and checked status", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        listItem: "check",
        level: 1,
        checked: true,
        children: [{ _type: "span", _key: "s1", text: "Finished item", marks: [] }],
      },
      {
        _type: "block",
        _key: "b2",
        style: "normal",
        listItem: "check",
        level: 1,
        checked: false,
        children: [{ _type: "span", _key: "s2", text: "Todo item", marks: [] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const listNode = childAt(editor, 0);
    expect(listNode).toMatchObject({
      type: "list",
      listType: "check",
    });

    const items = listNode?.children as Array<{ type: string; checked: boolean }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "listitem", checked: true });
    expect(items[1]).toMatchObject({ type: "listitem", checked: false });
  });

  it("losslessly round-trips nested check lists with checkListMapping: 'check'", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "k1",
        style: "normal",
        listItem: "check",
        level: 1,
        checked: false,
        children: [{ _type: "span", _key: "s1", text: "Parent todo", marks: [] }],
      },
      {
        _type: "block",
        _key: "k2",
        style: "normal",
        listItem: "check",
        level: 2,
        checked: true,
        children: [{ _type: "span", _key: "s2", text: "Subtask done", marks: [] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const roundTripped = lexicalToPortableText(editor, {
      checkListMapping: "check",
      keyGenerator: counterKeys(),
    });

    expect(stripKeys(roundTripped)).toEqual(stripKeys(ptBlocks));
  });
});

describe("Feature: AutoLink and Link Metadata (title, target, rel)", () => {
  it("converts Lexical autolink nodes to link mark definitions", () => {
    const serialized = state(
      paragraph(autolink("https://example.com", text("https://example.com"))),
    );

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(block).toMatchObject({
      _type: "block",
      markDefs: [
        {
          _type: "link",
          _key: "k2",
          href: "https://example.com",
        },
      ],
      children: [
        {
          _type: "span",
          text: "https://example.com",
          marks: ["k2"],
        },
      ],
    });
  });

  it("preserves title, target, and rel metadata on save", () => {
    const serialized = state(
      paragraph(
        linkWithMeta(
          "https://example.com",
          { title: "Example Site", target: "_blank", rel: "noopener noreferrer" },
          text("Visit Example"),
        ),
      ),
    );

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(block).toMatchObject({
      markDefs: [
        {
          _type: "link",
          href: "https://example.com",
          title: "Example Site",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      ],
      children: [
        {
          text: "Visit Example",
        },
      ],
    });
  });

  it("deduplicates identical links with identical metadata, but separates differing metadata", () => {
    const serialized = state(
      paragraph(
        linkWithMeta("https://example.com", { target: "_blank" }, text("Link A")),
        text(" and "),
        linkWithMeta("https://example.com", { target: "_blank" }, text("Link A copy")),
        text(" and "),
        linkWithMeta("https://example.com", { target: "_self" }, text("Link B")),
      ),
    );

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    const markDefs = (block as { markDefs: Array<{ _key: string; target?: string }> }).markDefs;
    expect(markDefs).toHaveLength(2);
    expect(markDefs[0]?.target).toBe("_blank");
    expect(markDefs[1]?.target).toBe("_self");

    const spanList = spans(block);
    expect(spanList[0]?.marks).toEqual([markDefs[0]?._key]);
    expect(spanList[2]?.marks).toEqual([markDefs[0]?._key]);
    expect(spanList[4]?.marks).toEqual([markDefs[1]?._key]);
  });

  it("forwards link metadata to factories.link on load", () => {
    const linkSpy = vi.fn(
      (
        url: string,
        children: LexicalNode[],
        meta?: { title?: string; target?: string; rel?: string },
      ) => {
        return $createLinkNode(url, meta).append(...children);
      },
    );

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [
          {
            _type: "link",
            _key: "l1",
            href: "https://example.com",
            title: "Doc title",
            target: "_blank",
            rel: "nofollow",
          },
        ],
        children: [{ _type: "span", _key: "s1", text: "Link text", marks: ["l1"] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        link: linkSpy,
      },
    });

    expect(linkSpy).toHaveBeenCalledWith("https://example.com", expect.anything(), {
      title: "Doc title",
      target: "_blank",
      rel: "nofollow",
    });

    const exported = childAt(editor, 0);
    const linkNode = (exported?.children as Array<Record<string, unknown>>)?.[0];
    expect(linkNode).toMatchObject({
      type: "link",
      url: "https://example.com",
      title: "Doc title",
      target: "_blank",
      rel: "nofollow",
    });
  });

  it("losslessly round-trips link metadata", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [
          {
            _type: "link",
            _key: "l1",
            href: "https://x.com",
            title: "Twitter",
            target: "_blank",
            rel: "noopener",
          },
        ],
        children: [{ _type: "span", _key: "s1", text: "Check Twitter", marks: ["l1"] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const roundTripped = lexicalToPortableText(editor, { keyGenerator: counterKeys() });
    expect(stripKeys(roundTripped[0]!.markDefs)).toEqual(stripKeys(ptBlocks[0]!.markDefs));
    expect(stripKeys((roundTripped[0] as PortableTextBlock).children[0])).toMatchObject({
      _type: "span",
      text: "Check Twitter",
    });
  });
});

describe("Feature: Custom Mark Definitions / Annotations", () => {
  it("processes custom annotations with annotationRules on load", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [
          {
            _type: "comment",
            _key: "c1",
            commentId: "cmt_123",
          },
        ],
        children: [{ _type: "span", _key: "s1", text: "Annotated text", marks: ["c1"] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      annotationRules: [
        {
          type: "comment",
          toLexical: (def, children) => {
            // Represent comment as a link node with comment URL for test purposes
            return $createLinkNode(
              `comment:${(def as unknown as { commentId: string }).commentId}`,
            ).append(...children);
          },
        },
      ],
    });

    const p = childAt(editor, 0);
    const commentNode = (p?.children as Array<Record<string, unknown>>)?.[0];
    expect(commentNode).toMatchObject({
      type: "link",
      url: "comment:cmt_123",
    });
    expect(textOf(commentNode)).toBe("Annotated text");
  });

  it("falls back to factories.annotation for unhandled mark definition types", () => {
    const annotationSpy = vi.fn((def: PortableTextMarkDefinition, children: LexicalNode[]) => {
      return $createLinkNode(`annot:${def._type}`).append(...children);
    });

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [{ _type: "footnote", _key: "fn1", footnoteNumber: 1 }],
        children: [{ _type: "span", _key: "s1", text: "Has footnote", marks: ["fn1"] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        annotation: annotationSpy,
      },
    });

    expect(annotationSpy).toHaveBeenCalled();
    const p = childAt(editor, 0);
    expect(textOf(p)).toBe("Has footnote");
  });

  it("handles stacked annotations: link + custom annotation + decorator", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [
          { _type: "link", _key: "l1", href: "https://example.com" },
          { _type: "comment", _key: "c1", author: "alice" },
        ],
        children: [
          { _type: "span", _key: "s1", text: "Rich annotated", marks: ["l1", "c1", "strong"] },
        ],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      annotationRules: [
        {
          type: "comment",
          toLexical: (def, children) => {
            return $createLinkNode(
              `author:${(def as unknown as { author: string }).author}`,
            ).append(...children);
          },
        },
      ],
    });

    const p = childAt(editor, 0);
    expect(textOf(p)).toBe("Rich annotated");
    const linkNodes = collect(p, "link");
    expect(linkNodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Feature: Custom Inline Objects", () => {
  it("converts inline Lexical nodes to Portable Text inline objects via rules", () => {
    const serialized = state(
      paragraph(
        text("Hello "),
        { type: "mention", version: 1, userId: "u_42", label: "@Bob" } as never,
        text("!"),
      ),
    );

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      rules: [
        {
          type: "mention",
          toPortableText: (node) => ({
            _type: "mention",
            userId: (node as unknown as { userId: string }).userId,
            label: (node as unknown as { label: string }).label,
          }),
        },
      ],
    });

    expect((block as { children: Array<Record<string, unknown>> }).children).toEqual([
      { _type: "span", _key: "k2", text: "Hello ", marks: [] },
      { _type: "mention", _key: "k3", userId: "u_42", label: "@Bob" },
      { _type: "span", _key: "k4", text: "!", marks: [] },
    ]);
  });

  it("loads Portable Text inline objects using rules", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [
          { _type: "span", _key: "s1", text: "Hey ", marks: [] },
          { _type: "mention", _key: "m1", name: "Alice" } as ArbitraryTypedObject,
          { _type: "span", _key: "s2", text: " welcome!", marks: [] },
        ],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      rules: [
        {
          type: "mention",
          toLexical: (block) => {
            return $createTextNode(`[@${(block as unknown as { name: string }).name}]`);
          },
        },
      ],
    });

    const p = childAt(editor, 0);
    expect(textOf(p)).toBe("Hey [@Alice] welcome!");
  });

  it("loads Portable Text inline objects using factories.object fallback", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [
          { _type: "span", _key: "s1", text: "Status: ", marks: [] },
          { _type: "badge", _key: "badge1", label: "ACTIVE" } as ArbitraryTypedObject,
        ],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        object: (obj) => {
          if (obj._type === "badge") {
            return $createTextNode(`[${(obj as unknown as { label: string }).label}]`);
          }
          return null;
        },
      },
    });

    const p = childAt(editor, 0);
    expect(textOf(p)).toBe("Status: [ACTIVE]");
  });
});

describe("Feature: Custom Block Styles and Rules", () => {
  it("allows custom rules for Portable Text block styles", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "lead",
        children: [{ _type: "span", _key: "s1", text: "Important lead text", marks: [] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      rules: [
        {
          type: "lead",
          toLexical: (block) => {
            return $createParagraphNode().append(
              $createTextNode(textOf(block)).setFormat(LEXICAL_FORMAT.italic),
            );
          },
        },
      ],
    });

    const p = childAt(editor, 0);
    expect(p).toMatchObject({ type: "paragraph" });
    const textNode = (p?.children as Array<{ text: string; format: number }>)?.[0];
    expect(textNode?.format).toBe(LEXICAL_FORMAT.italic);
  });

  it("supports factories.blockStyle fallback for custom styles", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "caption",
        children: [{ _type: "span", _key: "s1", text: "Photo caption", marks: [] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        blockStyle: (style, children) => {
          if (style === "caption") {
            return $createParagraphNode().append(...children);
          }
          return null;
        },
      },
    });

    const p = childAt(editor, 0);
    expect(textOf(p)).toBe("Photo caption");
  });
});

describe("Feature: Formatting & Indent Preservation", () => {
  it("preserves format ('center', 'right', 'justify') when preserveFormat is true", () => {
    const serialized = state(
      {
        type: "paragraph",
        version: 1,
        format: "center",
        children: [text("Centered paragraph")],
      },
      heading("h1", text("Right title")),
    );
    (serialized.root.children[1] as { format?: string }).format = "right";

    const blocks = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      preserveFormat: true,
    });

    expect(blocks[0]).toMatchObject({
      style: "normal",
      format: "center",
    });
    expect(blocks[1]).toMatchObject({
      style: "h1",
      format: "right",
    });
  });

  it("preserves indent when preserveIndent is true", () => {
    const serialized = state({
      type: "paragraph",
      version: 1,
      indent: 2,
      children: [text("Indented text")],
    });

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      preserveIndent: true,
    });

    expect(block).toMatchObject({
      indent: 2,
    });
  });

  it("applies format and indent to Lexical ElementNode when present in Portable Text", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        format: "center",
        indent: 2,
        children: [{ _type: "span", _key: "s1", text: "Centered and indented", marks: [] }],
      } as PortableTextBlock & { format: string; indent: number },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const p = childAt(editor, 0);
    expect(p).toMatchObject({
      format: "center",
      indent: 2,
    });
  });
});

describe("Feature: Code Block Metadata (filename)", () => {
  it("preserves filename in Portable Text code block on save", () => {
    const serialized = state(codeWithFilename("typescript", "const x: number = 42;", "index.ts"));

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(block).toMatchObject({
      _type: "code",
      language: "typescript",
      code: "const x: number = 42;",
      filename: "index.ts",
    });
  });

  it("passes filename to factories.code on load", () => {
    const codeSpy = vi.fn(
      (language: string | null, children: LexicalNode[], meta?: { filename?: string }) => {
        return factories.code!(language, children, meta);
      },
    );

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "code",
        _key: "c1",
        language: "rust",
        code: "fn main() {}",
        filename: "main.rs",
      } as ArbitraryTypedObject,
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        code: codeSpy,
      },
    });

    expect(codeSpy).toHaveBeenCalledWith("rust", expect.anything(), { filename: "main.rs" });
  });
});

describe("Feature: Tables", () => {
  it("converts Lexical table node to standard Portable Text table block", () => {
    const serialized = state(
      table(
        tableRow(tableCell(text("Header 1")), tableCell(text("Header 2"))),
        tableRow(tableCell(text("Cell 1")), tableCell(text("Cell 2"))),
      ),
    );

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(block).toEqual({
      _type: "table",
      _key: "k1",
      rows: [
        {
          _type: "tableRow",
          _key: "k2",
          cells: ["Header 1", "Header 2"],
        },
        {
          _type: "tableRow",
          _key: "k3",
          cells: ["Cell 1", "Cell 2"],
        },
      ],
    });
  });

  it("loads Portable Text table block into Lexical using table factories", () => {
    const tableSpy = vi.fn((rows: LexicalNode[]) => $createParagraphNode().append(...rows));
    const rowSpy = vi.fn((cells: LexicalNode[]) => $createParagraphNode().append(...cells));
    const cellSpy = vi.fn((children: LexicalNode[]) => $createParagraphNode().append(...children));

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "table",
        _key: "t1",
        rows: [
          { _type: "tableRow", _key: "r1", cells: ["A", "B"] },
          { _type: "tableRow", _key: "r2", cells: ["C", "D"] },
        ],
      } as PortableTextTableBlock,
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        table: tableSpy,
        tableRow: rowSpy,
        tableCell: cellSpy,
      },
    });

    expect(tableSpy).toHaveBeenCalled();
    expect(rowSpy).toHaveBeenCalledTimes(2);
    expect(cellSpy).toHaveBeenCalledTimes(4);
  });
});

describe("Feature: Well-Known Mark Aliases", () => {
  it.each([
    [["bold"], LEXICAL_FORMAT.bold],
    [["b"], LEXICAL_FORMAT.bold],
    [["italic"], LEXICAL_FORMAT.italic],
    [["i"], LEXICAL_FORMAT.italic],
    [["strikethrough"], LEXICAL_FORMAT.strikethrough],
    [["strike"], LEXICAL_FORMAT.strikethrough],
    [["s"], LEXICAL_FORMAT.strikethrough],
    [["u"], LEXICAL_FORMAT.underline],
    [["sub"], LEXICAL_FORMAT.subscript],
    [["subscript"], LEXICAL_FORMAT.subscript],
    [["sup"], LEXICAL_FORMAT.superscript],
    [["superscript"], LEXICAL_FORMAT.superscript],
    [["highlight"], LEXICAL_FORMAT.highlight],
    [["mark"], LEXICAL_FORMAT.highlight],
  ])("recognizes alias %j -> format %i", (marks, expectedFormat) => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Text", marks }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const p = childAt(editor, 0);
    const textNode = (p?.children as Array<{ text: string; format: number }>)?.[0];
    expect(textNode?.format).toBe(expectedFormat);
  });

  it("can disable alias parsing via parseAliases: false", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Text", marks: ["bold"] }],
      },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      parseAliases: false,
    });

    const p = childAt(editor, 0);
    const textNode = (p?.children as Array<{ text: string; format: number }>)?.[0];
    expect(textNode?.format).toBe(0);
  });
});

describe("Feature: Image blocks", () => {
  it("converts Lexical image nodes to Portable Text image blocks with metadata", () => {
    const serialized = state({
      type: "image",
      version: 1,
      src: "https://example.com/hero.jpg",
      altText: "Hero landscape",
      title: "Photo of mountains",
      caption: "Sunset in the Alps",
      width: 1200,
      height: 800,
    } as never);

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect(block).toEqual({
      _type: "image",
      _key: "k1",
      url: "https://example.com/hero.jpg",
      alt: "Hero landscape",
      title: "Photo of mountains",
      caption: "Sunset in the Alps",
      width: 1200,
      height: 800,
    });
  });

  it("loads Portable Text image blocks into Lexical using factories.image", () => {
    const imageSpy = vi.fn(
      (
        block: ArbitraryTypedObject,
        meta?: { url?: string; alt?: string; title?: string; width?: number; height?: number },
      ) => {
        return $createParagraphNode().append(
          $createTextNode(`[IMAGE: ${meta?.url} - ${meta?.alt}]`),
        );
      },
    );

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "image",
        _key: "img1",
        url: "https://cdn.sanity.io/images/demo.png",
        alt: "Demo graphic",
        width: 640,
        height: 480,
      } as PortableTextImageBlock,
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        image: imageSpy,
      },
    });

    expect(imageSpy).toHaveBeenCalledWith(expect.objectContaining({ _type: "image" }), {
      url: "https://cdn.sanity.io/images/demo.png",
      alt: "Demo graphic",
      title: undefined,
      width: 640,
      height: 480,
    });
    expect(textOf(childAt(editor, 0))).toBe(
      "[IMAGE: https://cdn.sanity.io/images/demo.png - Demo graphic]",
    );
  });

  it("supports Sanity asset object format on load", () => {
    const imageSpy = vi.fn((block: ArbitraryTypedObject, meta?: { url?: string }) => {
      return $createParagraphNode().append($createTextNode(`Asset: ${meta?.url}`));
    });

    const ptBlocks: PortableTextContent[] = [
      {
        _type: "image",
        _key: "img2",
        asset: {
          _ref: "image-abc-1200x800-jpg",
          url: "https://cdn.sanity.io/images/xyz/production/abc-1200x800.jpg",
        },
      } as ArbitraryTypedObject,
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories: {
        ...factories,
        image: imageSpy,
      },
    });

    expect(imageSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        url: "https://cdn.sanity.io/images/xyz/production/abc-1200x800.jpg",
      }),
    );
  });
});

describe("Feature: Text Direction (LTR / RTL)", () => {
  it("preserves direction ('rtl' | 'ltr') when preserveDirection is true", () => {
    const serialized = state(
      {
        type: "paragraph",
        version: 1,
        direction: "rtl",
        children: [text("نص تجريبي")],
      },
      {
        type: "paragraph",
        version: 1,
        direction: "ltr",
        children: [text("English text")],
      },
    );

    const blocks = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      preserveDirection: true,
    });

    expect(blocks[0]).toMatchObject({
      style: "normal",
      direction: "rtl",
    });
    expect(blocks[1]).toMatchObject({
      style: "normal",
      direction: "ltr",
    });
  });

  it("applies direction to Lexical element node on load", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        direction: "rtl",
        children: [{ _type: "span", _key: "s1", text: "שלום עולם", marks: [] }],
      } as PortableTextBlock & { direction: "rtl" },
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, { factories });

    const p = childAt(editor, 0);
    expect(p).toMatchObject({
      direction: "rtl",
    });
  });
});

describe("Feature: Sanity Studio Empty Block Compatibility (blankSpanOnEmptyBlock)", () => {
  it("emits an empty span when blankSpanOnEmptyBlock: true", () => {
    const serialized = state(paragraph());

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
      blankSpanOnEmptyBlock: true,
    });

    expect(block).toMatchObject({
      _type: "block",
      style: "normal",
      children: [
        {
          _type: "span",
          text: "",
          marks: [],
        },
      ],
    });
  });

  it("leaves children empty when blankSpanOnEmptyBlock is false (default)", () => {
    const serialized = state(paragraph());

    const [block] = lexicalToPortableText(serialized, {
      keyGenerator: counterKeys(),
    });

    expect((block as PortableTextBlock).children).toEqual([]);
  });
});

describe("Feature: Flexible Input Shapes", () => {
  it("converts a single SerializedElementNode directly", () => {
    const singlePara = paragraph(text("Single paragraph direct"));
    const blocks = lexicalToPortableText(singlePara as never, {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(1);
    expect(spans(blocks[0])[0]?.text).toBe("Single paragraph direct");
  });

  it("converts an array of SerializedLexicalNode directly", () => {
    const nodeArray = [heading("h2", text("Section Title")), paragraph(text("Section body text"))];
    const blocks = lexicalToPortableText(nodeArray, {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as PortableTextBlock).style).toBe("h2");
    expect(spans(blocks[1])[0]?.text).toBe("Section body text");
  });

  it("converts an object with a .toJSON() method returning SerializedLexicalState", () => {
    const stateObj = {
      toJSON: () => state(paragraph(text("From custom toJSON"))),
    };
    const blocks = lexicalToPortableText(stateObj, {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(1);
    expect(spans(blocks[0])[0]?.text).toBe("From custom toJSON");
  });
});

describe("Feature: Recursive Block Conversion in PortableTextToLexicalContext", () => {
  it("enables custom container rules to recursively convert nested Portable Text blocks", () => {
    const ptBlocks: PortableTextContent[] = [
      {
        _type: "callout",
        _key: "c1",
        tone: "info",
        body: [
          {
            _type: "block",
            _key: "b1",
            style: "normal",
            children: [{ _type: "span", _key: "s1", text: "Inside callout line 1", marks: [] }],
          },
          {
            _type: "block",
            _key: "b2",
            style: "normal",
            children: [{ _type: "span", _key: "s2", text: "Inside callout line 2", marks: [] }],
          },
        ],
      } as ArbitraryTypedObject,
    ];

    const editor = makeEditor();
    portableTextToLexical(editor, ptBlocks, {
      factories,
      rules: [
        {
          type: "callout",
          toLexical: (block, context) => {
            const bodyBlocks = (block as { body?: PortableTextContent[] }).body ?? [];
            const innerNodes = context.convertBlocks(bodyBlocks);
            // Wrap in a paragraph containing the converted inner paragraphs
            const container = $createParagraphNode();
            for (const node of innerNodes) {
              container.append(node);
            }
            return container;
          },
        },
      ],
    });

    const rootNodes = rootChildren(editor);
    expect(rootNodes).toHaveLength(1);
    expect(textOf(rootNodes[0])).toBe("Inside callout line 1Inside callout line 2");
  });
});

describe("Feature: Plain Text Extraction (portableTextToPlainText)", () => {
  it("extracts plain text from paragraphs, headings, and quotes", () => {
    const blocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "h1",
        children: [{ _type: "span", _key: "s1", text: "Document Title", marks: [] }],
      },
      {
        _type: "block",
        _key: "b2",
        style: "normal",
        children: [
          { _type: "span", _key: "s2", text: "Hello ", marks: [] },
          { _type: "span", _key: "s3", text: "bold world", marks: ["strong"] },
          { _type: "span", _key: "s4", text: "!", marks: [] },
        ],
      },
      {
        _type: "block",
        _key: "b3",
        style: "blockquote",
        children: [{ _type: "span", _key: "s5", text: "Wisdom quote", marks: [] }],
      },
    ];

    const result = portableTextToPlainText(blocks);
    expect(result).toBe("Document Title\n\nHello bold world!\n\nWisdom quote");
  });

  it("handles code blocks and tables by default", () => {
    const blocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Code below:", marks: [] }],
      },
      {
        _type: "code",
        _key: "c1",
        language: "typescript",
        code: "const answer = 42;",
      },
      {
        _type: "table",
        _key: "t1",
        rows: [
          { _type: "tableRow", _key: "r1", cells: ["Name", "Score"] },
          { _type: "tableRow", _key: "r2", cells: ["Alice", "100"] },
        ],
      } as PortableTextTableBlock,
    ];

    const result = portableTextToPlainText(blocks);
    expect(result).toBe("Code below:\n\nconst answer = 42;\n\nName\tScore\nAlice\t100");
  });

  it("respects custom blockSeparator, includeCode: false, and includeTables: false", () => {
    const blocks: PortableTextContent[] = [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [{ _type: "span", _key: "s1", text: "Para 1", marks: [] }],
      },
      {
        _type: "code",
        _key: "c1",
        code: "ignored()",
      },
      {
        _type: "table",
        _key: "t1",
        rows: [{ _type: "tableRow", _key: "r1", cells: ["Ignored"] }],
      } as PortableTextTableBlock,
      {
        _type: "block",
        _key: "b2",
        style: "normal",
        children: [{ _type: "span", _key: "s2", text: "Para 2", marks: [] }],
      },
    ];

    const result = portableTextToPlainText(blocks, {
      blockSeparator: " --- ",
      includeCode: false,
      includeTables: false,
    });

    expect(result).toBe("Para 1 --- Para 2");
  });

  it("returns an empty string for empty or invalid blocks", () => {
    expect(portableTextToPlainText([])).toBe("");
    expect(portableTextToPlainText([null as never, undefined as never, {} as never])).toBe("");
  });
});
