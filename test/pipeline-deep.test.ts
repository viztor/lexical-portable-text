import { describe, expect, it } from "vitest";

import {
  allSetupChecksPassed,
  definePipeline,
  lexicalToPortableText,
  portableTextToLexical,
  type ArbitraryTypedObject,
  type CustomBlockDefinition,
  type PortableTextBlock,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import { CalloutNode } from "./callout.js";

import type { PortableTextToLexicalContext } from "../src/index.js";
import { canonicalize, counterKeys, factories, makeEditor, textOf } from "./helpers.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

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

describe("definePipeline — rule precedence", () => {
  it("user hand-written rules override bundled definitions of the same type", () => {
    const pipeline = definePipeline([badge], {
      save: {
        keyGenerator: counterKeys(),
        rules: [
          {
            type: "badge",
            toPortableText: (node, ctx) => ({
              _type: "badge",
              _key: ctx.key(),
              label: "OVERRIDE",
            }),
          },
        ],
      },
    });

    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [{ type: "badge", version: 1, label: "ORIGINAL" }],
        },
      },
      pipeline.saveOptions,
    );

    expect((blocks[0] as { label?: string }).label).toBe("OVERRIDE");
  });

  it("duplicate types inside one definitions array are flagged; later wins", () => {
    const pipeline = definePipeline([
      badge,
      {
        type: "badge",
        save: () => ({ _type: "badge", _key: "dup", label: "SECOND" }),
        load: () => factories.paragraph([]),
      },
    ] as CustomBlockDefinition[]);

    expect(pipeline.issues).toHaveLength(1);
    expect(pipeline.issues[0]?.message).toMatch(/duplicate definition for "badge"/);

    // Later definition wins at runtime.
    const blocks = lexicalToPortableText(
      { root: { type: "root", version: 1, children: [{ type: "badge", version: 1, label: "x" }] } },
      pipeline.saveOptions,
    );
    expect((blocks[0] as { label?: string }).label).toBe("SECOND");
  });
});

describe("definePipeline — fallback and delegation", () => {
  it("save half returning null delegates to default (children salvaged)", () => {
    const pipeline = definePipeline([
      { type: "passthrough", save: () => null },
    ] as CustomBlockDefinition[]);

    const blocks = lexicalToPortableText(
      {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "passthrough",
              version: 1,
              children: [
                {
                  type: "paragraph",
                  version: 1,
                  children: [{ type: "text", version: 1, text: "salvaged", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      pipeline.saveOptions,
    );

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { children?: Array<{ text?: string }> }).children?.[0]?.text).toBe(
      "salvaged",
    );
  });

  it("annotation save half returning null drops the mark, keeps the text", () => {
    const pipeline = definePipeline([
      { type: "ghost", annotation: true, save: () => null },
    ] as CustomBlockDefinition[]);
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
                  type: "ghost",
                  version: 1,
                  _key: "g1",
                  children: [{ type: "text", version: 1, text: "kept", format: 0 }],
                },
              ],
            },
          ],
        },
      },
      pipeline.saveOptions,
    );

    const block = blocks[0] as PortableTextBlock;
    expect(block.markDefs).toBeUndefined();
    const spans = block.children as PortableTextSpan[];
    expect(spans.map((span) => span.text)).toEqual(["kept"]);
    expect(spans[0]?.marks).toEqual([]);
  });

  it("load half returning null follows the object factory, else skips", () => {
    const pipeline = definePipeline([
      { type: "void", load: () => null },
    ] as CustomBlockDefinition[]);
    const editor = makeEditor();

    portableTextToLexical(
      editor,
      [{ _type: "void", _key: "v1" } as PortableTextContent],
      pipeline.loadOptions({
        ...factories,
        object: (block) =>
          block._type === "void"
            ? factories.paragraph([factories.text("from object factory", 0)])
            : null,
      }),
    );

    expect(textOf(editor.getEditorState().toJSON().root.children[0] as unknown)).toBe(
      "from object factory",
    );
  });

  it("definition save with no load half still loads via factories.object", () => {
    const pipeline = definePipeline([
      { type: "half", save: (node, ctx) => ({ _type: "half", _key: ctx.key() }) },
    ] as CustomBlockDefinition[]);
    expect(pipeline.issues).toHaveLength(1);

    const editor = makeEditor();
    portableTextToLexical(
      editor,
      [{ _type: "half", _key: "h1" } as PortableTextContent],
      pipeline.loadOptions({
        ...factories,
        object: (block) =>
          block._type === "half" ? factories.paragraph([factories.text("fallback", 0)]) : null,
      }),
    );

    expect(textOf(editor.getEditorState().toJSON().root.children[0] as unknown)).toBe("fallback");
  });
});

describe("definePipeline — nesting and stacking", () => {
  const container: CustomBlockDefinition = {
    type: "callout",
    save: (node, ctx) => ({
      _type: "callout",
      _key: ctx.key(),
      tone: String((node as { tone?: string }).tone ?? "note"),
      content: ctx.convertBlocks((node as { children?: never[] }).children ?? []),
    }),
    load: (block: ArbitraryTypedObject, context: PortableTextToLexicalContext) => {
      const node = new CalloutNode(String((block as { tone?: string }).tone ?? "note"));
      node.append(
        ...(context.convertBlocks(
          (block as { content?: PortableTextContent[] }).content ?? [],
        ) as never[]),
      );
      return node;
    },
  };

  it("two-level nested containers round-trip canonically", () => {
    const pipeline = definePipeline([container], {
      factories,
      save: { keyGenerator: counterKeys() },
    });
    const innerBlock = (text: string): PortableTextContent =>
      ({
        _type: "block",
        _key: `i${text}`,
        style: "normal",
        children: [{ _type: "span", _key: `s${text}`, text, marks: [] }],
      }) as PortableTextContent;
    const source: PortableTextContent[] = [
      {
        _type: "callout",
        _key: "outer",
        tone: "info",
        content: [
          innerBlock("first"),
          {
            _type: "callout",
            _key: "inner",
            tone: "warn",
            content: [innerBlock("nested")],
          } as PortableTextContent,
        ],
      } as PortableTextContent,
    ];

    const editor = makeEditor([CalloutNode]);
    portableTextToLexical(editor, source, pipeline.loadOptions(factories));
    const back = lexicalToPortableText(editor, pipeline.saveOptions) as PortableTextContent[];
    expect(canonicalize(back)).toEqual(canonicalize(source));

    // Idempotent on a second pass.
    const again = lexicalToPortableText(editor, pipeline.saveOptions) as PortableTextContent[];
    expect(canonicalize(again)).toEqual(canonicalize(source));
  });

  it("built-in constructs are unaffected when a pipeline is attached", () => {
    const pipeline = definePipeline(
      [
        badge,
        {
          type: "callout",
          save: (node, ctx) => ({ _type: "callout", _key: ctx.key() }),
          load: (_block: ArbitraryTypedObject) => new CalloutNode("note"),
        },
      ] as CustomBlockDefinition[],
      { factories, save: { keyGenerator: counterKeys() } },
    );

    const doc = {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: "plain", format: 1 }],
          },
          {
            type: "heading",
            version: 1,
            tag: "h2",
            children: [{ type: "text", version: 1, text: "T", format: 0 }],
          },
          { type: "hr", version: 1 },
          {
            type: "code",
            version: 1,
            language: "ts",
            filename: "a.ts",
            children: [{ type: "code-highlight", version: 1, text: "x()", format: 0 }],
          },
        ],
      },
    } as never;

    const withPipeline = lexicalToPortableText(doc, pipeline.saveOptions);
    const withoutPipeline = lexicalToPortableText(doc, { keyGenerator: counterKeys() });
    // Identical output apart from nothing at all — the attach is passive.
    expect(withPipeline).toEqual(withoutPipeline);
  });
});

describe("definePipeline — broken halves surface in verifySetup", () => {
  it("a load half that builds nothing is reported by the loadRules check", () => {
    const broken = definePipeline([
      { type: "stubborn", load: () => null },
    ] as CustomBlockDefinition[]);

    // Without factories: must FAIL (not silently skip) because load halves exist.
    const withoutFactories = broken.verify(makeEditor());
    const factoriesCheck = withoutFactories.find((check) => check.name === "factoriesProvided");
    expect(factoriesCheck?.ok).toBe(false);
    expect(factoriesCheck?.problems[0]).toMatch(/load\(\) halves but no factories/);

    // With factories: the broken load half surfaces through loadRules.
    const withFactories = definePipeline(
      [
        {
          type: "stubborn",
          load: () => null,
        },
      ] as CustomBlockDefinition[],
      { factories },
    );
    const checks = withFactories.verify(makeEditor());
    const loadRules = checks.find((check) => check.name === "loadRules");
    expect(loadRules?.ok).toBe(false);
    expect(loadRules?.problems[0]).toMatch(/stubborn/);
  });

  it("a pipeline with one-sided definitions surfaces them in an issues check", () => {
    const pipeline = definePipeline([
      { type: "half", save: () => ({ _type: "half", _key: "h" }) },
    ] as CustomBlockDefinition[]);
    const checks = pipeline.verify(makeEditor());
    const issuesCheck = checks.find((check) => check.name === "issues");
    expect(issuesCheck?.ok).toBe(false);
    expect(issuesCheck?.problems[0]).toContain("[load]");
    expect(allSetupChecksPassed(checks)).toBe(false);
  });

  it("a healthy pipeline verifies fully including the round-trip probe", () => {
    const pipeline = definePipeline(
      [
        badge,
        {
          type: "callout",
          save: (n, c) => ({ _type: "callout", _key: c.key() }),
          load: (block: ArbitraryTypedObject) =>
            new CalloutNode(String((block as { tone?: string }).tone ?? "note")),
        },
        {
          type: "callout2",
          save: () => ({ _type: "callout2", _key: "k" }),
          load: () => new CalloutNode("note"),
        },
      ] as CustomBlockDefinition[],
      { factories },
    );
    const checks = pipeline.verify(makeEditor([CalloutNode]));
    expect(allSetupChecksPassed(checks)).toBe(true);
  });
});
