/**
 * Portable Text → Lexical.
 *
 * Design notes (learned from the existing converters):
 * - Nodes are built with caller-supplied factories (`$createTextNode`,
 *   `$createHeadingNode`, …) instead of emitting raw serialized JSON —
 *   Lexical's serialized `version` fields are version-sensitive, and
 *   `@lexical/markdown`'s `$convertFromMarkdownString` works the same way.
 * - Rules apply to custom Portable Text objects (both top-level blocks and
 *   inline objects like mentions) and custom block styles.
 * - Custom mark definitions (annotations like internal links, comments,
 *   footnotes) are supported via annotation rules or the `annotation` factory.
 * - Checklists / task lists preserve both `listType: "check"` and `checked: boolean`.
 * - Link metadata (title, target, rel) is forwarded to the `link` factory.
 * - Lists regroup consecutive `listItem` blocks into Lexical list trees by
 *   `level`, since Portable Text lists are flat.
 */
import type {
  ArbitraryTypedObject,
  PortableTextBlock,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from "@portabletext/types";
import {
  $getRoot,
  $isElementNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

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
  code?(
    language: string | null,
    children: LexicalNode[],
    meta?: { filename?: string },
  ): LexicalNode;
  link?(
    url: string,
    children: LexicalNode[],
    meta?: { title?: string; target?: string; rel?: string },
  ): LexicalNode;
  linebreak?(): LexicalNode;
  horizontalRule?(): LexicalNode;
  table?(rows: LexicalNode[]): LexicalNode;
  tableRow?(cells: LexicalNode[]): LexicalNode;
  tableCell?(children: LexicalNode[]): LexicalNode;
  image?(
    block: ArbitraryTypedObject,
    meta?: { url?: string; alt?: string; title?: string; width?: number; height?: number },
  ): LexicalNode;
  /** Custom block style handler (e.g. "subtitle", "lead", "callout"). */
  blockStyle?(style: string, children: LexicalNode[], block: PortableTextBlock): LexicalNode | null;
  /** Custom mark definition handler for non-link annotations (comments, footnotes, etc.). */
  annotation?(def: PortableTextMarkDefinition, children: LexicalNode[]): LexicalNode | null;
  /** Custom Portable Text object blocks / inline objects without a dedicated rule. */
  object?(block: ArbitraryTypedObject): LexicalNode | LexicalNode[] | null;
}

export interface PortableTextToLexicalContext {
  options: PortableTextToLexicalOptions;
  /** Recursively convert child Portable Text blocks into Lexical nodes. */
  convertBlocks(blocks: readonly PortableTextContent[]): LexicalNode[];
  /** Convert inline text spans and annotations from a block. */
  convertInline(block: PortableTextBlock): LexicalNode[];
}

export interface PortableTextToLexicalRule {
  /** Portable Text `_type` or block `style` this rule handles. */
  type: string;
  toLexical(
    block: ArbitraryTypedObject,
    context: PortableTextToLexicalContext,
  ): RuleResult<LexicalNode | LexicalNode[]>;
}

export interface PortableTextToLexicalAnnotationRule {
  /** Portable Text mark definition `_type` (e.g. `"internalLink"`, `"comment"`). */
  type: string;
  toLexical(
    def: PortableTextMarkDefinition,
    children: LexicalNode[],
    context: PortableTextToLexicalContext,
  ): RuleResult<LexicalNode>;
}

export interface PortableTextToLexicalOptions extends MarkMappingOptions {
  factories: LexicalNodeFactories;
  rules?: PortableTextToLexicalRule[];
  annotationRules?: PortableTextToLexicalAnnotationRule[];
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
  rules: Map<string, PortableTextToLexicalRule>,
  annotationRules: Map<string, PortableTextToLexicalAnnotationRule>,
): LexicalNode[] {
  const { factories } = options;
  const markDefs = new Map<string, PortableTextMarkDefinition>();
  for (const def of block.markDefs ?? []) {
    if (def._key) markDefs.set(def._key, def);
  }

  const nodes: LexicalNode[] = [];
  const context: PortableTextToLexicalContext = {
    options,
    convertBlocks: (childBlocks) => blocksToNodes(childBlocks, options),
    convertInline: (childBlock) => inlineNodes(childBlock, options, rules, annotationRules),
  };

  for (const child of block.children ?? []) {
    if (child._type !== "span") {
      // Inline object: first check rules, then factory fallback
      const rule = rules.get(child._type);
      if (rule) {
        const result = rule.toLexical(child as ArbitraryTypedObject, context);
        if (result !== null) {
          nodes.push(...toNodes(result));
          continue;
        }
      }
      const object = factories.object?.(child as ArbitraryTypedObject);
      if (object) nodes.push(...toNodes(object));
      continue;
    }

    const span = child as PortableTextSpan;
    if (typeof span.text !== "string" || span.text === "") continue;
    const marks = span.marks ?? [];

    const annotationDefs: PortableTextMarkDefinition[] = [];
    const decorators: string[] = [];

    for (const mark of marks) {
      const def = markDefs.get(mark);
      if (def) {
        annotationDefs.push(def);
      } else {
        decorators.push(mark);
      }
    }

    const format = marksToFormat(decorators, options);
    let spanNodes = textChildren(span.text, format, factories);

    // Apply annotations from innermost to outermost
    for (const def of annotationDefs) {
      if (def._type === "link") {
        if (factories.link) {
          const meta: { title?: string; target?: string; rel?: string } = {};
          if (typeof def.title === "string") meta.title = def.title;
          if (typeof def.target === "string") meta.target = def.target;
          if (typeof def.rel === "string") meta.rel = def.rel;
          spanNodes = [factories.link(String(def.href ?? ""), spanNodes, meta)];
          continue;
        }
      }

      // Check annotation rules
      const annotRule = annotationRules.get(def._type);
      if (annotRule) {
        const result = annotRule.toLexical(def, spanNodes, context);
        if (result !== null) {
          spanNodes = [result];
          continue;
        }
      }

      // Check annotation factory
      if (factories.annotation) {
        const res = factories.annotation(def, spanNodes);
        if (res !== null) {
          spanNodes = [res];
          continue;
        }
      }
    }

    nodes.push(...spanNodes);
  }
  return nodes;
}

function applyElementFormatting(node: LexicalNode, block: PortableTextBlock): LexicalNode {
  if ($isElementNode(node)) {
    const el = node as ElementNode;
    const format = (block as { format?: unknown }).format;
    if (typeof format === "string" && format) {
      el.setFormat(format as Parameters<ElementNode["setFormat"]>[0]);
    }
    const indent = (block as { indent?: unknown }).indent;
    if (typeof indent === "number" && indent > 0) {
      el.setIndent(indent);
    }
    const direction = (block as { direction?: unknown }).direction;
    if (direction === "ltr" || direction === "rtl") {
      el.setDirection(direction);
    }
  }
  return node;
}

function textBlockToNode(
  block: PortableTextBlock,
  options: PortableTextToLexicalOptions,
  rules: Map<string, PortableTextToLexicalRule>,
  annotationRules: Map<string, PortableTextToLexicalAnnotationRule>,
): LexicalNode {
  const { factories } = options;
  const children = inlineNodes(block, options, rules, annotationRules);
  const style = typeof block.style === "string" ? block.style : "normal";

  // Check custom block style rule or factory
  const context: PortableTextToLexicalContext = {
    options,
    convertBlocks: (childBlocks) => blocksToNodes(childBlocks, options),
    convertInline: (childBlock) => inlineNodes(childBlock, options, rules, annotationRules),
  };

  const styleRule = rules.get(style);
  if (styleRule) {
    const res = styleRule.toLexical(block as ArbitraryTypedObject, context);
    if (res !== null) {
      const node = Array.isArray(res) ? res[0]! : res;
      return applyElementFormatting(node, block);
    }
  }

  if (factories.blockStyle) {
    const res = factories.blockStyle(style, children, block);
    if (res !== null) {
      return applyElementFormatting(res, block);
    }
  }

  if (style === "blockquote") {
    if (factories.quote) {
      return applyElementFormatting(factories.quote(children), block);
    }
    options.onMissingFactory?.("quote", block);
    return applyElementFormatting(factories.paragraph(children), block);
  }

  if (style !== "normal") {
    if (factories.heading && HEADING_TAGS.has(style as HeadingTag)) {
      return applyElementFormatting(factories.heading(style as HeadingTag, children), block);
    }
    options.onMissingFactory?.("heading", block);
  }

  return applyElementFormatting(factories.paragraph(children), block);
}

function buildListRun(
  run: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
  rules: Map<string, PortableTextToLexicalRule>,
  annotationRules: Map<string, PortableTextToLexicalAnnotationRule>,
): LexicalNode[] {
  if (run.length === 0) return [];
  return buildListLevel(run, 0, levelOf(run[0]!), options, rules, annotationRules).nodes;
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
  rules: Map<string, PortableTextToLexicalRule>,
  annotationRules: Map<string, PortableTextToLexicalAnnotationRule>,
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
      const inline = inlineNodes(run[index]! as PortableTextBlock, options, rules, annotationRules);
      const checked = (run[index] as { checked?: unknown }).checked === true;
      items.push(
        factories.listItem ? factories.listItem(inline, { checked }) : factories.paragraph(inline),
      );
      index += 1;

      if (index < run.length && levelOf(run[index]!) > level) {
        const nested = buildListLevel(
          run,
          index,
          levelOf(run[index]!),
          options,
          rules,
          annotationRules,
        );
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
  context: PortableTextToLexicalContext,
): LexicalNode[] {
  const { factories } = options;

  const rule = rules.get(block._type);
  if (rule) {
    const result = rule.toLexical(block as ArbitraryTypedObject, context);
    if (result !== null) return toNodes(result);
  }

  if (block._type === "code") {
    const codeBlock = block as unknown as {
      code?: unknown;
      language?: unknown;
      filename?: unknown;
    };
    const code = typeof codeBlock.code === "string" ? codeBlock.code : "";
    const language = typeof codeBlock.language === "string" ? codeBlock.language : null;
    const filename = typeof codeBlock.filename === "string" ? codeBlock.filename : undefined;
    const children = textChildren(code, 0, factories);
    if (factories.code) return [factories.code(language, children, { filename })];
    options.onMissingFactory?.("code", block);
    return [factories.paragraph(children)];
  }

  if (
    block._type === "horizontal-rule" ||
    block._type === "hr" ||
    block._type === "break" ||
    block._type === "divider"
  ) {
    return factories.horizontalRule ? [factories.horizontalRule()] : [];
  }

  if (block._type === "table") {
    const tableBlock = block as ArbitraryTypedObject & {
      rows?: Array<{ cells?: string[] }>;
    };
    if (factories.table) {
      const rows: LexicalNode[] = [];
      for (const row of tableBlock.rows ?? []) {
        const cells: LexicalNode[] = [];
        for (const cellText of row.cells ?? []) {
          const cellChildren = textChildren(cellText, 0, factories);
          cells.push(
            factories.tableCell
              ? factories.tableCell(cellChildren)
              : factories.paragraph(cellChildren),
          );
        }
        rows.push(factories.tableRow ? factories.tableRow(cells) : factories.paragraph(cells));
      }
      return [factories.table(rows)];
    }
  }

  if (block._type === "image") {
    if (factories.image) {
      const img = block as Record<string, unknown>;
      const rawUrl = img.url ?? (img.asset as Record<string, unknown> | undefined)?.url;
      const url = typeof rawUrl === "string" ? rawUrl : undefined;
      const alt = typeof img.alt === "string" ? img.alt : undefined;
      const title = typeof img.title === "string" ? img.title : undefined;
      const width = typeof img.width === "number" ? img.width : undefined;
      const height = typeof img.height === "number" ? img.height : undefined;
      return [factories.image(block as ArbitraryTypedObject, { url, alt, title, width, height })];
    }
  }

  const object = factories.object?.(block as ArbitraryTypedObject);
  if (object) return toNodes(object);

  // Unknown object blocks are skipped rather than rendered as garbage.
  return [];
}

function blocksToNodes(
  blocks: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): LexicalNode[] {
  const rules = new Map((options.rules ?? []).map((rule) => [rule.type, rule]));
  const annotationRules = new Map((options.annotationRules ?? []).map((rule) => [rule.type, rule]));
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
      out.push(...buildListRun(run, options, rules, annotationRules));
      continue;
    }

    if (block._type === "block") {
      out.push(textBlockToNode(block as PortableTextBlock, options, rules, annotationRules));
      index += 1;
      continue;
    }

    const context: PortableTextToLexicalContext = {
      options,
      convertBlocks: (childBlocks) => blocksToNodes(childBlocks, options),
      convertInline: (childBlock) => inlineNodes(childBlock, options, rules, annotationRules),
    };
    out.push(...objectBlockToNode(block, options, rules, context));
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
