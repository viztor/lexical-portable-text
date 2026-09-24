import { describe, expect, it } from "vitest";

import {
  allSetupChecksPassed,
  formatSetupChecks,
  lexicalToPortableText,
  portableTextToLexicalNodes,
  verifySetup,
  type PortableTextBlock,
  type PortableTextSpan,
  type SerializedLexicalNode,
  type LexicalToPortableTextContext,
  type ArbitraryTypedObject,
} from "../src/index.js";
import { counterKeys, factories, makeEditor, textOf } from "./helpers.js";

describe("verifySetup — default configuration", () => {
  it("passes every check with no custom configuration", () => {
    const checks = verifySetup();
    expect(checks.map((check) => check.name)).toEqual([
      "savePipeline",
      "saveRules",
      "saveAnnotationRules",
      "loadRules",
      "loadAnnotationRules",
      "markNames",
      "roundTripProbe",
    ]);
    expect(allSetupChecksPassed(checks)).toBe(true);
    expect(formatSetupChecks(checks)).toMatch(/✔ savePipeline/);
  });
});

describe("verifySetup — custom save rules", () => {
  it("exercises a custom save rule and confirms it produces blocks", () => {
    const checks = verifySetup({
      save: {
        rules: [
          {
            type: "hero",
            toPortableText: (node, ctx) => ({
              _type: "hero",
              _key: ctx.key(),
              heading: textOf(node),
            }),
          },
        ],
      },
    });
    const saveRules = checks.find((check) => check.name === "saveRules");
    expect(saveRules?.ok).toBe(true);
    expect(saveRules?.problems).toEqual([]);
  });

  it("reports a throwing save rule as a problem", () => {
    const checks = verifySetup({
      save: {
        rules: [
          {
            type: "exploding",
            toPortableText: () => {
              throw new Error("boom");
            },
          },
        ],
      },
    });
    const saveRules = checks.find((check) => check.name === "saveRules");
    expect(saveRules?.ok).toBe(false);
    expect(saveRules?.problems[0]).toMatch(/boom/);
    expect(allSetupChecksPassed(checks)).toBe(false);
  });
});

describe("verifySetup — save-side annotation rules", () => {
  it("confirms annotation rules produce markDefs referenced by spans", () => {
    const checks = verifySetup({
      save: {
        annotationRules: [
          {
            type: "comment",
            toPortableText: (node) => ({
              _type: "comment",
              _key: `c-${String((node as { commentId?: string }).commentId ?? "x")}`,
              commentId: String((node as { commentId?: string }).commentId ?? "x"),
            }),
          },
        ],
      },
    });
    const annotationCheck = checks.find((check) => check.name === "saveAnnotationRules");
    expect(annotationCheck?.ok).toBe(true);
  });
});

describe("verifySetup — custom load rules and factories", () => {
  it("exercises custom load rules through the app factories", () => {
    const editor = makeEditor();
    const checks = verifySetup({
      editor,
      load: {
        factories,
        rules: [
          {
            type: "hero",
            toLexical: () => factories.paragraph([factories.text("hero", 0)]),
          },
        ],
      },
    });
    const loadRules = checks.find((check) => check.name === "loadRules");
    expect(loadRules?.ok).toBe(true);

    const loadAnnotations = checks.find((check) => check.name === "loadAnnotationRules");
    expect(loadAnnotations?.ok).toBe(true);

    const roundTrip = checks.find((check) => check.name === "roundTripProbe");
    expect(roundTrip?.ok).toBe(true);
  });

  it("reports a load rule returning no nodes", () => {
    const editor = makeEditor();
    const checks = verifySetup({
      editor,
      load: {
        factories,
        rules: [
          {
            type: "void",
            toLexical: () => null,
          },
        ],
      },
    });
    const loadRules = checks.find((check) => check.name === "loadRules");
    expect(loadRules?.ok).toBe(false);
    expect(loadRules?.problems[0]).toMatch(/no Lexical nodes/);
  });

  it("reports missing editor/factories instead of silently skipping load checks", () => {
    const checks = verifySetup({
      load: {
        factories,
        rules: [{ type: "hero", toLexical: () => factories.paragraph([]) }],
      },
    });
    const loadRules = checks.find((check) => check.name === "loadRules");
    expect(loadRules?.ok).toBe(false);
    expect(loadRules?.problems[0]).toMatch(/requires both/);
  });
});

describe("verifySetup — mark name symmetry", () => {
  it("round-trips custom mark names", () => {
    const editor = makeEditor();
    const names = { bold: "b", italic: "i" } as const;
    const checks = verifySetup({
      editor,
      save: { names },
      load: { factories, names },
    });
    const markNames = checks.find((check) => check.name === "markNames");
    expect(markNames?.ok).toBe(true);
  });

  it("flags asymmetric custom names between save and load", () => {
    const editor = makeEditor();
    const checks = verifySetup({
      editor,
      save: { names: { bold: "b" } },
      load: { factories, names: { bold: "strong" } },
    });
    const markNames = checks.find((check) => check.name === "markNames");
    expect(markNames?.ok).toBe(false);
    expect(markNames?.problems[0]).toMatch(/does not survive the mark-name round trip/);
  });
});

describe("save-side annotationRules — end to end", () => {
  it("converts a custom Lexical comment wrapper into a PT mark definition", () => {
    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [
                { type: "text", version: 1, text: "plain ", format: 0 },
                {
                  type: "comment",
                  version: 1,
                  _key: "comment-node-1",
                  commentId: "c_42",
                  children: [{ type: "text", version: 1, text: "annotated", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      {
        keyGenerator: counterKeys(),
        annotationRules: [
          {
            type: "comment",
            toPortableText: (node, _ctx) => ({
              _type: "comment",
              _key: `c-${String((node as { commentId?: string }).commentId)}`,
              commentId: String((node as { commentId?: string }).commentId),
            }),
          },
        ],
      },
    );

    const block = blocks[0] as PortableTextBlock;
    expect(block.markDefs).toEqual([{ _type: "comment", _key: "c-c_42", commentId: "c_42" }]);
    const spans = block.children as PortableTextSpan[];
    expect(spans.map((span) => span.text)).toEqual(["plain ", "annotated"]);
    expect(spans[1]?.marks).toEqual(["c-c_42"]);
  });

  it("deduplicates repeated annotation wrapper keys and nests with decorators", () => {
    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [
                {
                  type: "comment",
                  version: 1,
                  _key: "c-node",
                  commentId: "dup",
                  children: [
                    { type: "text", version: 1, text: "bold annotated", format: 1 },
                    {
                      type: "comment",
                      version: 1,
                      _key: "c-inner",
                      commentId: "inner",
                      children: [{ type: "text", version: 1, text: " twice", format: 0 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        keyGenerator: counterKeys(),
        annotationRules: [
          {
            type: "comment",
            toPortableText: (node, ctx) => ({
              _type: "comment",
              _key: `c-${String((node as { commentId?: string }).commentId)}-${ctx.key()}`,
              commentId: String((node as { commentId?: string }).commentId),
            }),
          },
        ],
      },
    );

    const block = blocks[0] as PortableTextBlock;
    const defs = block.markDefs ?? [];
    // Two annotation wrappers → exactly two mark definitions.
    expect(defs).toHaveLength(2);
    const spans = block.children as PortableTextSpan[];
    expect(spans.map((span) => span.text)).toEqual(["bold annotated", " twice"]);
    // Outer wrapper's mark applies to both child spans.
    expect(spans[0]?.marks).toHaveLength(2);
    expect(spans[0]?.marks).toContain("strong");
    expect(spans[1]?.marks).toHaveLength(2);
  });

  it("falls back to default handling when the annotation rule returns null", () => {
    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [
                {
                  type: "comment",
                  version: 1,
                  _key: "c-node",
                  commentId: "x",
                  children: [{ type: "text", version: 1, text: "salvaged", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      {
        keyGenerator: counterKeys(),
        annotationRules: [{ type: "comment", toPortableText: () => null }],
      },
    );

    const block = blocks[0] as PortableTextBlock;
    expect(block.markDefs).toBeUndefined();
    const spans = block.children as PortableTextSpan[];
    expect(spans.map((span) => span.text)).toEqual(["salvaged"]);
    expect(spans[0]?.marks).toEqual([]);
  });

  it("works inside list items and headings", () => {
    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "heading",
              version: 1,
              tag: "h2",
              children: [
                {
                  type: "comment",
                  version: 1,
                  _key: "c-h",
                  commentId: "head",
                  children: [{ type: "text", version: 1, text: "title", format: 0 }],
                },
              ],
            },
            {
              type: "list",
              version: 1,
              listType: "bullet",
              children: [
                {
                  type: "listitem",
                  version: 1,
                  value: 1,
                  children: [
                    {
                      type: "comment",
                      version: 1,
                      _key: "c-l",
                      commentId: "item",
                      children: [{ type: "text", version: 1, text: "item text", format: 0 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        keyGenerator: counterKeys(),
        annotationRules: [
          {
            type: "comment",
            toPortableText: (node, _ctx) => ({
              _type: "comment",
              _key: `c-${String((node as { commentId?: string }).commentId)}`,
              commentId: String((node as { commentId?: string }).commentId),
            }),
          },
        ],
      },
    );

    const headingBlock = blocks[0] as PortableTextBlock;
    expect(headingBlock.style).toBe("h2");
    expect(headingBlock.markDefs?.[0]).toMatchObject({ commentId: "head" });

    const listItemBlock = blocks[1] as PortableTextBlock;
    expect(listItemBlock.listItem).toBe("bullet");
    expect(listItemBlock.markDefs?.[0]).toMatchObject({ commentId: "item" });
  });
});

describe("full custom pipeline verification", () => {
  it("round-trips a custom block + custom annotation setup through verifySetup and a real document", () => {
    const editor = makeEditor();
    const saveOptions = {
      keyGenerator: counterKeys(),
      rules: [
        {
          type: "hero",
          toPortableText: (node: SerializedLexicalNode, ctx: LexicalToPortableTextContext) => ({
            _type: "hero",
            _key: ctx.key(),
            text: textOf(node),
          }),
        },
      ] as never,
      annotationRules: [
        {
          type: "comment",
          toPortableText: (node: SerializedLexicalNode, ctx: LexicalToPortableTextContext) => ({
            _type: "comment",
            _key: ctx.key(),
            commentId: String((node as { commentId?: string }).commentId ?? ""),
          }),
        },
      ] as never,
    };

    const verifyResult = verifySetup({
      editor,
      save: saveOptions,
      load: {
        factories,
        rules: [
          {
            type: "hero",
            toLexical: (block: ArbitraryTypedObject) =>
              factories.paragraph([
                factories.text(String((block as { text?: string }).text), 0),
              ] as never),
          },
        ],
      } as never,
    });
    expect(allSetupChecksPassed(verifyResult)).toBe(true);

    // And the real document converts through both paths.
    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "hero",
              version: 1,
              children: [{ type: "text", version: 1, text: "Launch", format: 0 }],
            },
            {
              type: "paragraph",
              version: 1,
              children: [
                {
                  type: "comment",
                  version: 1,
                  _key: "cn",
                  commentId: "z9",
                  children: [{ type: "text", version: 1, text: "reviewed", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      saveOptions as never,
    );

    expect(blocks.map((block) => block._type)).toEqual(["hero", "block"]);
    expect((blocks[0] as { text?: string }).text).toBe("Launch");
    expect((blocks[1] as PortableTextBlock).markDefs?.[0]).toMatchObject({ commentId: "z9" });

    const nodes: unknown[] = [];
    editor.update(
      () => {
        nodes.push(
          ...portableTextToLexicalNodes(
            [{ _type: "hero", _key: "h1", text: "Launch Docs" }] as never,
            {
              factories,
              rules: [
                {
                  type: "hero",
                  toLexical: (block: ArbitraryTypedObject) =>
                    factories.paragraph([
                      factories.text(String((block as { text?: string }).text), 0),
                    ] as never),
                },
              ],
            } as never,
          ),
        );
      },
      { discrete: true },
    );
    expect(nodes).toHaveLength(1);
  });
});
