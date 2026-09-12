/**
 * Stress tests: big inputs and deep recursion are not correctness guarantees
 * by themselves, but they catch accidental O(n²) behaviour and stack issues
 * that unit tests miss. No timing assertions — only completion + shape.
 */
import { describe, expect, it } from "vitest";

import {
  lexicalToPortableText,
  portableTextToLexical,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
  type SerializedLexicalNode,
} from "../src/index.js";
import { childAt, collect, counterKeys, factories, makeEditor, state, text } from "./helpers.js";

let counter = 0;
const key = (): string => `s${(counter += 1)}`;

describe("stress: document size", () => {
  it("converts and round-trips a 1000-block document", () => {
    const children = Array.from({ length: 1000 }, (_, index) => ({
      type: "paragraph",
      version: 1,
      children: [text(`Paragraph ${index}`)],
    })) as SerializedLexicalNode[];

    const blocks = lexicalToPortableText(state(...children), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(1000);

    const editor = makeEditor();
    portableTextToLexical(editor, blocks, { factories });
    const saved = lexicalToPortableText(editor) as PortableTextContent[];
    expect(saved).toHaveLength(1000);
  });

  it("round-trips a 500-link block", () => {
    const children: PortableTextSpan[] = [];
    const markDefs: Array<{ _type: string; _key: string; href: string }> = [];
    for (let index = 0; index < 500; index += 1) {
      const markKey = key();
      markDefs.push({
        _type: "link",
        _key: markKey,
        href: `https://example.com/${index}`,
      });
      children.push({
        _type: "span",
        _key: key(),
        text: `link ${index}`,
        marks: [markKey],
      });
      children.push({ _type: "span", _key: key(), text: " ", marks: [] });
    }
    const block: PortableTextBlock = {
      _type: "block",
      _key: key(),
      style: "normal",
      children,
      markDefs,
    };

    const editor = makeEditor();
    portableTextToLexical(editor, [block], { factories });
    expect(collect(childAt(editor, 0), "link")).toHaveLength(500);
    const saved = lexicalToPortableText(editor) as PortableTextBlock[];
    expect(saved[0]?.markDefs).toHaveLength(500);
  });

  it("preserves a 50k-character span", () => {
    const value = `start-${"y".repeat(50_000)}-end`;
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        {
          _type: "block",
          _key: key(),
          style: "normal",
          children: [{ _type: "span", _key: key(), text: value, marks: [] }],
        },
      ],
      { factories },
    );
    const [block] = lexicalToPortableText(editor) as PortableTextBlock[];
    expect((block?.children[0] as PortableTextSpan | undefined)?.text).toBe(value);
  });
});

describe("stress: deep structures", () => {
  it("converts a 30-level nested list", () => {
    let inner: SerializedLexicalNode | null = null;
    for (let level = 30; level >= 1; level -= 1) {
      const item: SerializedLexicalNode = {
        type: "listitem",
        version: 1,
        value: 1,
        children: inner ? [text(`L${level}`), inner] : [text(`L${level}`)],
      };
      inner = { type: "list", version: 1, listType: "bullet", children: [item] };
    }

    const blocks = lexicalToPortableText(state(inner!), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(30);
    expect(blocks.map((block) => (block as { level?: number }).level)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });

  it("loads a 30-level list back", () => {
    const blocks = Array.from({ length: 30 }, (_, index) => ({
      _type: "block",
      _key: key(),
      style: "normal",
      listItem: "bullet",
      level: index + 1,
      children: [{ _type: "span", _key: key(), text: `L${index + 1}`, marks: [] }],
    })) as PortableTextBlock[];

    const editor = makeEditor();
    portableTextToLexical(editor, blocks, { factories });
    expect(collect(childAt(editor, 0), "list")).toHaveLength(30);
  });

  it("salvages content through 200 nested unknown inline wrappers", () => {
    let node: SerializedLexicalNode = text("deep");
    for (let depth = 0; depth < 200; depth += 1) {
      node = { type: "wrapper", version: 1, children: [node] };
    }
    const blocks = lexicalToPortableText(
      state({ type: "paragraph", version: 1, children: [node] }),
      { keyGenerator: counterKeys() },
    );
    expect((blocks[0] as { children: PortableTextSpan[] }).children[0]?.text).toBe("deep");
  });

  it("salvages content through 200 nested unknown block wrappers", () => {
    let node: SerializedLexicalNode = {
      type: "paragraph",
      version: 1,
      children: [text("deep block")],
    };
    for (let depth = 0; depth < 200; depth += 1) {
      node = { type: "wrapper", version: 1, children: [node] };
    }
    const blocks = lexicalToPortableText(state(node), {
      keyGenerator: counterKeys(),
    });
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { children: PortableTextSpan[] }).children[0]?.text).toBe("deep block");
  });

  it("converts a 100-span paragraph with alternating marks", () => {
    const children = Array.from({ length: 100 }, (_, index) =>
      text(`part${index} `, index % 2 === 0 ? 1 : 0),
    );
    const blocks = lexicalToPortableText(
      state(
        ...[
          {
            type: "paragraph",
            version: 1,
            children,
          },
        ],
      ),
      { keyGenerator: counterKeys() },
    );
    expect((blocks[0] as { children: PortableTextSpan[] }).children).toHaveLength(100);
  });
});
