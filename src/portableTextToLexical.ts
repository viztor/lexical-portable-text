/**
 * Portable Text → Lexical.
 *
 * Design notes (learned from the existing converters):
 * - Nodes are built with caller-supplied factories (`$createTextNode`,
 *   `$createHeadingNode`, …) instead of emitting raw serialized JSON —
 *   Lexical's serialized `version` fields are version-sensitive, and
 *   `@lexical/markdown`'s `$convertFromMarkdownString` works the same way.
 * - Custom Portable Text objects go through rules keyed by `_type`, then a
 *   generic `object` factory — mirroring `@portabletext/to-html`'s
 *   component-map + fallback approach.
 * - Lists regroup consecutive `listItem` blocks into Lexical list trees by
 *   `level`, since Portable Text lists are flat.
 */
import type {
  ArbitraryTypedObject,
  PortableTextBlock,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from "@portabletext/types";
import { $getRoot, $isElementNode, type LexicalEditor, type LexicalNode } from "lexical";

import { marksToFormat, type MarkMappingOptions } from "./marks.js";
import type { PortableTextContent, RuleResult } from "./types.js";

export type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const HEADING_TAGS = new Set<HeadingTag>(["h1", "h2", "h3", "h4", "h5", "h6"]);

export interface LexicalNodeFactories {
  /** Required: a text node with the given format bitmask applied. */
  text(text: string, format: number): LexicalNode;
  /** Required: fallback element for paragraphs and missing factories. */
  paragraph(children: LexicalNode[]): LexicalNode;
  heading?(tag: HeadingTag, children: LexicalNode[]): LexicalNode;
  quote?(children: LexicalNode[]): LexicalNode;
  list?(listType: "bullet" | "number" | "check", children: LexicalNode[]): LexicalNode;
  listItem?(children: LexicalNode[], meta: { checked?: boolean }): LexicalNode;
  code?(language: string | null, children: LexicalNode[]): LexicalNode;
  link?(url: string, children: LexicalNode[]): LexicalNode;
  linebreak?(): LexicalNode;
  horizontalRule?(): LexicalNode;
  /** Custom Portable Text object blocks without a dedicated rule. */
  object?(block: ArbitraryTypedObject): LexicalNode | LexicalNode[] | null;
}

export interface PortableTextToLexicalContext {
  options: PortableTextToLexicalOptions;
}

export interface PortableTextToLexicalRule {
  /** Portable Text `_type` this rule handles (e.g. `"callout"`). */
  type: string;
  toLexical(
    block: ArbitraryTypedObject,
    context: PortableTextToLexicalContext,
  ): RuleResult<LexicalNode | LexicalNode[]>;
}

export interface PortableTextToLexicalOptions extends MarkMappingOptions {
  factories: LexicalNodeFactories;
  rules?: PortableTextToLexicalRule[];
  /** Called when a factory is missing; the converter falls back to paragraph. */
  onMissingFactory?: (kind: string, block: PortableTextContent) => void;
}

function toNodes(value: LexicalNode | LexicalNode[]): LexicalNode[] {
  return Array.isArray(value) ? value : [value];
}

function levelOf(block: PortableTextContent): number {
  const level = (block as { level?: unknown }).level;
  return typeof level === "number" ? level : 1;
}

function listItemOf(block: PortableTextContent): string {
  const item = (block as { listItem?: unknown }).listItem;
  return typeof item === "string" ? item : "bullet";
}

function isListItemBlock(block: PortableTextContent): boolean {
  return block._type === "block" && "listItem" in block;
}

function textChildren(
  text: string,
  format: number,
  factories: LexicalNodeFactories,
): LexicalNode[] {
  const parts = text.split("\n");
  const nodes: LexicalNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push(factories.linebreak ? factories.linebreak() : factories.text("\n", format));
    }
    if (part.length > 0) nodes.push(factories.text(part, format));
  });
  return nodes;
}

function inlineNodes(
  block: PortableTextBlock,
  options: PortableTextToLexicalOptions,
): LexicalNode[] {
  const { factories } = options;
  const markDefs = new Map<string, PortableTextMarkDefinition>();
  for (const def of block.markDefs ?? []) {
    if (def._key) markDefs.set(def._key, def);
  }

  const nodes: LexicalNode[] = [];
  for (const child of block.children ?? []) {
    if (child._type !== "span") {
      const object = factories.object?.(child as ArbitraryTypedObject);
      if (object) nodes.push(...toNodes(object));
      continue;
    }

    const span = child as PortableTextSpan;
    if (typeof span.text !== "string" || span.text === "") continue;
    const marks = span.marks ?? [];
    const linkKey = marks.find((mark) => {
      const def = markDefs.get(mark);
      return def?._type === "link";
    });
    const decorators = marks.filter((mark) => !markDefs.has(mark));
    const format = marksToFormat(decorators, options);
    const spanNodes = textChildren(span.text, format, factories);

    if (linkKey && factories.link) {
      const def = markDefs.get(linkKey) as { href?: unknown } | undefined;
      nodes.push(factories.link(String(def?.href ?? ""), spanNodes));
    } else {
      nodes.push(...spanNodes);
    }
  }
  return nodes;
}

function textBlockToNode(
  block: PortableTextBlock,
  options: PortableTextToLexicalOptions,
): LexicalNode {
  const { factories } = options;
  const children = inlineNodes(block, options);
  const style = typeof block.style === "string" ? block.style : "normal";

  if (style === "blockquote") {
    if (factories.quote) return factories.quote(children);
    options.onMissingFactory?.("quote", block);
    return factories.paragraph(children);
  }

  if (style !== "normal") {
    if (factories.heading && HEADING_TAGS.has(style as HeadingTag)) {
      return factories.heading(style as HeadingTag, children);
    }
    options.onMissingFactory?.("heading", block);
  }

  return factories.paragraph(children);
}

function buildListRun(
  run: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): LexicalNode[] {
  if (run.length === 0) return [];
  return buildListLevel(run, 0, levelOf(run[0]!), options).nodes;
}

/**
 * Portable Text lists are flat (listItem + level); Lexical nests lists inside
 * list items. Walk level by level, attaching deeper runs to the preceding
 * item, and split consecutive items by `listItem` type at the same level.
 */
function buildListLevel(
  run: readonly PortableTextContent[],
  start: number,
  level: number,
  options: PortableTextToLexicalOptions,
): { nodes: LexicalNode[]; next: number } {
  const { factories } = options;
  const nodes: LexicalNode[] = [];
  let index = start;

  while (index < run.length) {
    const first = run[index]!;
    if (levelOf(first) !== level) break;
    const type = listItemOf(first);
    const items: LexicalNode[] = [];

    while (
      index < run.length &&
      levelOf(run[index]!) === level &&
      listItemOf(run[index]!) === type
    ) {
      const inline = inlineNodes(run[index]! as PortableTextBlock, options);
      const checked = (run[index] as { checked?: unknown }).checked === true;
      items.push(
        factories.listItem ? factories.listItem(inline, { checked }) : factories.paragraph(inline),
      );
      index += 1;

      if (index < run.length && levelOf(run[index]!) > level) {
        const nested = buildListLevel(run, index, levelOf(run[index]!), options);
        const previous = items[items.length - 1];
        if (previous) {
          if ($isElementNode(previous)) {
            for (const node of nested.nodes) previous.append(node);
          }
        }
        index = nested.next;
      }
    }

    const lexicalType = type === "number" ? "number" : type === "check" ? "check" : "bullet";
    nodes.push(factories.list ? factories.list(lexicalType, items) : factories.paragraph(items));
  }

  return { nodes, next: index };
}

function objectBlockToNode(
  block: PortableTextContent,
  options: PortableTextToLexicalOptions,
  rules: Map<string, PortableTextToLexicalRule>,
): LexicalNode[] {
  const { factories } = options;
  if (block._type === "code") {
    const codeBlock = block as unknown as {
      code?: unknown;
      language?: unknown;
    };
    const code = typeof codeBlock.code === "string" ? codeBlock.code : "";
    const language = typeof codeBlock.language === "string" ? codeBlock.language : null;
    const children = textChildren(code, 0, factories);
    if (factories.code) return [factories.code(language, children)];
    options.onMissingFactory?.("code", block);
    return [factories.paragraph(children)];
  }

  if (block._type === "horizontal-rule") {
    return factories.horizontalRule ? [factories.horizontalRule()] : [];
  }

  const rule = rules.get(block._type);
  if (rule) {
    const result = rule.toLexical(block, { options });
    if (result !== null) return toNodes(result);
  }

  const object = factories.object?.(block);
  if (object) return toNodes(object);

  // Unknown object blocks are skipped rather than rendered as garbage.
  return [];
}

function blocksToNodes(
  blocks: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): LexicalNode[] {
  const rules = new Map((options.rules ?? []).map((rule) => [rule.type, rule]));
  const out: LexicalNode[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index]!;

    if (isListItemBlock(block)) {
      const run: PortableTextContent[] = [];
      while (index < blocks.length && isListItemBlock(blocks[index]!)) {
        run.push(blocks[index]!);
        index += 1;
      }
      out.push(...buildListRun(run, options));
      continue;
    }

    if (block._type === "block") {
      out.push(textBlockToNode(block as PortableTextBlock, options));
      index += 1;
      continue;
    }

    out.push(...objectBlockToNode(block, options, rules));
    index += 1;
  }

  return out;
}

/**
 * Build Lexical nodes from Portable Text. Must be called inside an
 * `editor.update` / `editor.read` (`$`-prefixed) context.
 */
export function portableTextToLexicalNodes(
  blocks: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): LexicalNode[] {
  return blocksToNodes(blocks, options);
}

/**
 * Replace the editor's root contents with the given Portable Text blocks.
 * Uses a discrete update so the new state is readable synchronously.
 */
export function portableTextToLexical(
  editor: LexicalEditor,
  blocks: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      root.append(...blocksToNodes(blocks, options));
    },
    { discrete: true },
  );
}
