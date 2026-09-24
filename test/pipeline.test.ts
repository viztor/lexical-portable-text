import type { LexicalNode } from "lexical";
import { describe, expect, it } from "vitest";

import {
  allSetupChecksPassed,
  definePipeline,
  lexicalToPortableText,
  portableTextToLexical,
  verifySetup,
  type ArbitraryTypedObject,
  type CustomBlockDefinition,
  type PortableTextMarkDefinition,
  type PortableTextToLexicalContext,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import { CalloutNode } from "./callout.js";
import { canonicalize, counterKeys, factories, makeEditor, textOf } from "./helpers.js";

const callout: CustomBlockDefinition = {
  type: "callout",
  save: (node, ctx) => ({
    _type: "callout",
    _key: ctx.key(),
    tone: String((node as { tone?: string }).tone ?? "note"),
  }),
  load: (block: ArbitraryTypedObject) =>
    new CalloutNode(String((block as { tone?: string }).tone ?? "note")),
};

const comment: CustomBlockDefinition = {
  type: "comment",
  annotation: true,
  save: (node, ctx) => ({
    _type: "comment",
    _key: ctx.key(),
    commentId: String((node as { commentId?: string }).commentId ?? ""),
  }),
  load: (def: PortableTextMarkDefinition, children: LexicalNode[]) =>
    factories.link!(
      `comment:${String((def as unknown as { commentId?: string }).commentId)}`,
      children,
    ),
};

const badge: CustomBlockDefinition = {
  type: "badge",
  save: (node, ctx) => ({
    _type: "badge",
    _key: ctx.key(),
    label: String((node as { label?: string }).label ?? ""),
  }),
  load: (block: ArbitraryTypedObject) =>
    factories.text(`[${String((block as { label?: string }).label)}]`, 0 as never),
};

describe("definePipeline — wiring", () => {
  it("splits block and annotation definitions into the right rule arrays", () => {
    const pipeline = definePipeline([callout, comment, badge]);
    expect(pipeline.issues).toEqual([]);
    expect(pipeline.saveOptions.rules?.map((rule) => rule.type)).toEqual(["callout", "badge"]);
    expect(pipeline.saveOptions.annotationRules?.map((rule) => rule.type)).toEqual(["comment"]);
  });

  it("flags one-sided definitions in both directions", () => {
    const pipeline = definePipeline([
      { type: "save-only", save: () => ({ _type: "save-only", _key: "k" }) },
      { type: "load-only", load: () => factories.paragraph([]) },
      { type: "half-annot", annotation: true, save: () => ({ _type: "half-annot" }) },
    ] as CustomBlockDefinition[]);
    expect(pipeline.issues).toHaveLength(3);
    expect(pipeline.issues.map((issue) => issue.direction)).toEqual(["load", "save", "load"]);
    expect(pipeline.issues[0]?.message).toMatch(/no load\(\) half/);
    expect(pipeline.issues[1]?.message).toMatch(/no save\(\) half/);
  });

  it("merges and preserves base save options alongside generated rules", () => {
    const pipeline = definePipeline([callout], {
      save: { keyGenerator: counterKeys(), preserveFormat: true },
    });
    expect(pipeline.saveOptions.preserveFormat).toBe(true);
    expect(pipeline.saveOptions.rules?.map((rule) => rule.type)).toEqual(["callout"]);
    const load = pipeline.loadOptions(factories);
    expect(Object.keys(load.factories)).toContain("text");
    expect(load.rules?.map((rule) => rule.type)).toEqual(["callout"]);
    expect(load.annotationRules).toEqual([]);
  });
});

describe("definePipeline — end to end", () => {
  it("save: inline custom object node flows into block children", () => {
    const pipeline = definePipeline([badge], { save: { keyGenerator: counterKeys() } });
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
                { type: "text", version: 1, text: "Status: ", format: 0 },
                { type: "badge", version: 1, label: "NEW" },
              ],
            },
          ],
        },
      },
      pipeline.saveOptions,
    );
    const block = blocks[0] as PortableTextBlock;
    const children = block.children as PortableTextSpan[];
    expect(children.map((child) => child._type)).toEqual(["span", "badge"]);
    expect(children[1]).toMatchObject({ label: "NEW" });
  });

  it("load: inline object def builds nodes inside an update", () => {
    const pipeline = definePipeline([badge]);
    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [
        {
          _type: "block",
          _key: "b1",
          style: "normal",
          children: [
            { _type: "span", _key: "s1", text: "Status: ", marks: [] },
            { _type: "badge", _key: "bd1", label: "NEW" } as ArbitraryTypedObject,
          ],
        },
      ],
      pipeline.loadOptions(factories),
    );
    const root = (
      editor.getEditorState().toJSON().root.children as unknown[]
    )[0] as PortableTextBlock;
    expect(textOf(root)).toBe("Status: [NEW]");
  });

  it("save: annotation definition emits markDefs referenced by spans", () => {
    const pipeline = definePipeline([comment], { save: { keyGenerator: counterKeys() } });
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
                  _key: "cn",
                  commentId: "z9",
                  children: [{ type: "text", version: 1, text: "reviewed", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      pipeline.saveOptions,
    );
    const block = blocks[0] as PortableTextBlock;
    expect(block.markDefs?.[0]).toMatchObject({ _type: "comment", commentId: "z9" });
    const spans = block.children as PortableTextSpan[];
    expect(spans).toHaveLength(1);
    expect(spans[0]?.marks).toEqual([block.markDefs?.[0]?._key]);
  });

  it("load: nested container definition recurses via ctx.convertBlocks", () => {
    const pipeline = definePipeline(
      [
        {
          type: "callout",
          save: (node, ctx) => ({
            _type: "callout",
            _key: ctx.key(),
            tone: String((node as { tone?: string }).tone ?? "note"),
            content: ctx.convertBlocks((node as { children?: never[] }).children ?? []),
          }),
          load: (block: ArbitraryTypedObject, context: PortableTextToLexicalContext) => {
            const node = new CalloutNode(String((block as { tone?: string }).tone ?? "note"));
            const inner = context.convertBlocks(
              (block as { content?: PortableTextContent[] }).content ?? [],
            );
            node.append(...inner);
            return node;
          },
        },
      ],
      { factories },
    );
    expect(pipeline.issues).toEqual([]);
  });

  it("full block round-trip: PT -> editor -> PT through the pipeline", () => {
    const pipeline = definePipeline([callout], { factories });
    const source: PortableTextContent[] = [
      { _type: "callout", _key: "c1", tone: "warning" } as PortableTextContent,
    ];
    const editor = makeEditor([CalloutNode]);
    portableTextToLexical(editor, source, pipeline.loadOptions(factories));
    expect(
      (editor.getEditorState().toJSON().root as { children?: unknown[] }).children,
    ).toHaveLength(1);
    const blocks = lexicalToPortableText(editor, pipeline.saveOptions) as PortableTextContent[];
    expect(canonicalize(blocks)).toEqual(canonicalize(source));
  });
});

describe("definePipeline — verification integration", () => {
  it("pipeline.verify() passes for complete definitions with factories", () => {
    const pipeline = definePipeline([callout, comment, badge], { factories });
    const editor = makeEditor([CalloutNode]);
    const checks = pipeline.verify(editor);
    expect(allSetupChecksPassed(checks)).toBe(true);
  });

  it("one-sided load definition is flagged; the wired load half still verifies", () => {
    const pipeline = definePipeline([
      { type: "view-only", load: () => factories.paragraph([]) },
    ] as CustomBlockDefinition[]);
    expect(pipeline.issues[0]?.direction).toBe("save");
    const emptyEditor = makeEditor();
    const checks = verifySetup({ editor: emptyEditor, load: pipeline.loadOptions(factories) });
    const loadRules = checks.find((check) => check.name === "loadRules");
    expect(loadRules?.ok).toBe(true);
  });
});
