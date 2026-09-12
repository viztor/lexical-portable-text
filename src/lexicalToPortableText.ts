/**
 * Lexical serialized state → Portable Text.
 *
 * Design notes (learned from the existing converters):
 * - Rules are keyed by the Lexical node `type` string and may return `null`
 *   to fall back to default handling — the same escape hatch
 *   `@lexical/markdown` transformers use.
 * - Adjacent spans with identical marks merge, matching
 *   `@portabletext/markdown`'s output hygiene.
 * - Unknown elements either salvage their children or are skipped; content
 *   is never silently lost when `onUnknownNode` is the default `"children"`.
 * - The save path is pure: no Lexical runtime import, so it runs anywhere
 *   (server, worker, tests) against serialized state.
 */
import type {
  ArbitraryTypedObject,
  PortableTextBlock,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from "@portabletext/types";

import { randomKey } from "./keys.js";
import { formatToMarks, type MarkMappingOptions } from "./marks.js";
import type {
  KeyGenerator,
  LexicalStateInput,
  PortableTextContent,
  RuleResult,
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedLinkNode,
  SerializedTextNode,
} from "./types.js";

export interface LexicalToPortableTextContext {
  key: KeyGenerator;
  options: ConverterOptions;
  /** Convert child nodes as inline content (spans + mark definitions). */
  convertInline(children: SerializedLexicalNode[]): InlineConversion;
  /** Convert child nodes as block content. */
  convertBlocks(children: SerializedLexicalNode[]): PortableTextContent[];
}

export interface LexicalToPortableTextRule {
  /** Lexical node `type` this rule handles (e.g. `"callout"`). */
  type: string;
  /** Return block(s), or `null` to fall back to default handling. */
  toPortableText(
    node: SerializedLexicalNode,
    context: LexicalToPortableTextContext,
  ): RuleResult<PortableTextContent | PortableTextContent[]>;
}

export interface ConverterOptions extends MarkMappingOptions {
  /** Override Portable Text key generation. */
  keyGenerator?: KeyGenerator;
  /** Custom node rules. Built-in node types are handled either way. */
  rules?: LexicalToPortableTextRule[];
  /**
   * What to do with a node that has no rule and no built-in mapping.
   * - `"children"` (default): recurse, keeping child content
   * - `"skip"`: drop the node
   * - `"throw"`: fail loudly (strict pipelines)
   */
  onUnknownNode?: "children" | "skip" | "throw";
}

interface InlineConversion {
  children: (PortableTextSpan | ArbitraryTypedObject)[];
  markDefs: PortableTextMarkDefinition[];
  /** Keys of link mark definitions, so breaks stay outside linked runs. */
  linkKeys: Set<string>;
}

const HEADING_STYLES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function isEditor(input: LexicalStateInput): input is { getEditorState(): { toJSON(): never } } {
  return typeof (input as { getEditorState?: unknown }).getEditorState === "function";
}

function hasChildren(node: SerializedLexicalNode): node is SerializedElementNode {
  return Array.isArray((node as SerializedElementNode).children);
}

function sameMarks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark === b[index]);
}

function pushAll<T>(target: T[], value: T | T[]): void {
  if (Array.isArray(value)) target.push(...value);
  else target.push(value);
}

/** Lexical runs text nodes together; PT spans carrying `\n` are hard breaks. */
function appendBreak(conversion: InlineConversion, key: KeyGenerator): void {
  const last = conversion.children[conversion.children.length - 1];
  const lastSpan = last?._type === "span" ? (last as PortableTextSpan) : null;
  const insideLink =
    lastSpan !== null && (lastSpan.marks ?? []).some((mark) => conversion.linkKeys.has(mark));
  if (lastSpan && !insideLink) {
    lastSpan.text += "\n";
    return;
  }
  conversion.children.push({
    _type: "span",
    _key: key(),
    text: "\n",
    marks: [],
  });
}

/**
 * Convert a Lexical serialized editor state (or an editor instance) into
 * Portable Text blocks.
 */
export function lexicalToPortableText(
  input: LexicalStateInput,
  options: ConverterOptions = {},
): PortableTextContent[] {
  const state = isEditor(input) ? input.getEditorState().toJSON() : input;
  const key = options.keyGenerator ?? randomKey;
  const rules = new Map((options.rules ?? []).map((rule) => [rule.type, rule]));

  const context: LexicalToPortableTextContext = {
    key,
    options,
    convertInline: (children) => convertInline(children, key, options),
    convertBlocks: (children) => convertBlocks(children, key, options, rules),
  };

  const root = (state as { root?: SerializedElementNode }).root;
  return convertBlocks(root?.children ?? [], key, options, rules, context);
}

function convertInline(
  children: readonly SerializedLexicalNode[],
  key: KeyGenerator,
  options: ConverterOptions,
  extraMarks: readonly string[] = [],
  /** Identical link targets share one mark definition per block. */
  linkMarkKeys: Map<string, string> = new Map(),
): InlineConversion {
  const conversion: InlineConversion = {
    children: [],
    markDefs: [],
    linkKeys: new Set(),
  };

  for (const child of children) {
    if (child.type === "text") {
      const text = child as SerializedTextNode;
      if (typeof text.text !== "string" || text.text === "") continue;
      const marks = [...extraMarks, ...formatToMarks(text.format, options)];
      const last = conversion.children[conversion.children.length - 1];
      if (
        last &&
        last._type === "span" &&
        sameMarks((last as PortableTextSpan).marks ?? [], marks)
      ) {
        (last as PortableTextSpan).text += text.text;
      } else {
        conversion.children.push({
          _type: "span",
          _key: key(),
          text: text.text,
          marks,
        });
      }
      continue;
    }

    if (child.type === "linebreak") {
      appendBreak(conversion, key);
      continue;
    }

    if (child.type === "link") {
      const link = child as SerializedLinkNode;
      const signature = JSON.stringify([link.url ?? null]);
      let markKey = linkMarkKeys.get(signature);
      if (markKey === undefined) {
        markKey = key();
        linkMarkKeys.set(signature, markKey);
        conversion.linkKeys.add(markKey);
        conversion.markDefs.push({
          _type: "link",
          _key: markKey,
          href: link.url,
        });
      }
      const nested = convertInline(
        link.children ?? [],
        key,
        options,
        [...extraMarks, markKey],
        linkMarkKeys,
      );
      conversion.children.push(...nested.children);
      conversion.markDefs.push(...nested.markDefs);
      for (const nestedKey of nested.linkKeys) {
        conversion.linkKeys.add(nestedKey);
      }
      continue;
    }

    // Unknown inline node: salvage text from its children.
    if (hasChildren(child)) {
      const nested = convertInline(child.children, key, options, extraMarks, linkMarkKeys);
      conversion.children.push(...nested.children);
      conversion.markDefs.push(...nested.markDefs);
      for (const nestedKey of nested.linkKeys) {
        conversion.linkKeys.add(nestedKey);
      }
    }
  }

  return conversion;
}

function textBlock(
  style: string,
  children: readonly SerializedLexicalNode[],
  key: KeyGenerator,
  options: ConverterOptions,
  extra?: Partial<PortableTextBlock>,
): PortableTextBlock {
  // Block key is allocated before its children so keys read in document order.
  const blockKey = key();
  const inline = convertInline(children, key, options, [], new Map());
  const block = {
    _type: "block",
    _key: blockKey,
    style,
    children: inline.children,
    ...extra,
  } as PortableTextBlock;
  if (inline.markDefs.length > 0) block.markDefs = inline.markDefs;
  return block;
}

function listItemType(listType: unknown): "bullet" | "number" {
  return listType === "number" ? "number" : "bullet";
}

function splitListItem(item: SerializedElementNode): {
  inline: SerializedLexicalNode[];
  nested: SerializedElementNode[];
} {
  const inline: SerializedLexicalNode[] = [];
  const nested: SerializedElementNode[] = [];
  for (const child of item.children ?? []) {
    if (child.type === "list") nested.push(child as SerializedElementNode);
    else if (child.type === "paragraph" && hasChildren(child)) {
      inline.push(...child.children);
    } else inline.push(child);
  }
  return { inline, nested };
}

function convertList(
  node: SerializedElementNode,
  key: KeyGenerator,
  options: ConverterOptions,
  out: PortableTextContent[],
  listType: unknown,
  level: number,
): void {
  for (const item of node.children ?? []) {
    if (item.type !== "listitem") {
      out.push(...convertBlocks([item], key, options, new Map()));
      continue;
    }
    const { inline, nested } = splitListItem(item as SerializedElementNode);
    out.push(
      textBlock("normal", inline, key, options, {
        listItem: listItemType(listType),
        level,
      }),
    );
    for (const childList of nested) {
      convertList(
        childList,
        key,
        options,
        out,
        (childList as { listType?: unknown }).listType ?? listType,
        level + 1,
      );
    }
  }
}

function codeText(children: readonly SerializedLexicalNode[]): string {
  let text = "";
  for (const child of children) {
    if (child.type === "code-highlight" || child.type === "text") {
      text += (child as SerializedTextNode).text ?? "";
      continue;
    }
    if (child.type === "linebreak") {
      text += "\n";
      continue;
    }
    if (hasChildren(child)) text += codeText(child.children);
  }
  return text;
}

function convertBlocks(
  children: readonly SerializedLexicalNode[],
  key: KeyGenerator,
  options: ConverterOptions,
  rules: Map<string, LexicalToPortableTextRule>,
  context?: LexicalToPortableTextContext,
): PortableTextContent[] {
  const ctx: LexicalToPortableTextContext = context ?? {
    key,
    options,
    convertInline: (nodes) => convertInline(nodes, key, options),
    convertBlocks: (nodes) => convertBlocks(nodes, key, options, rules),
  };

  const out: PortableTextContent[] = [];

  for (const child of children) {
    const rule = rules.get(child.type);
    if (rule) {
      const result = rule.toPortableText(child, ctx);
      if (result !== null) {
        pushAll(out, result);
        continue;
      }
    }

    switch (child.type) {
      case "paragraph":
        out.push(
          textBlock("normal", (child as SerializedElementNode).children ?? [], key, options),
        );
        break;

      case "heading": {
        const tag = (child as { tag?: unknown }).tag;
        const style = typeof tag === "string" && HEADING_STYLES.has(tag) ? tag : "h2";
        out.push(textBlock(style, (child as SerializedElementNode).children ?? [], key, options));
        break;
      }

      case "quote":
        out.push(
          textBlock("blockquote", (child as SerializedElementNode).children ?? [], key, options),
        );
        break;

      case "list":
        convertList(
          child as SerializedElementNode,
          key,
          options,
          out,
          (child as { listType?: unknown }).listType,
          1,
        );
        break;

      case "code": {
        const language = (child as { language?: unknown }).language;
        out.push({
          _type: "code",
          _key: key(),
          language: typeof language === "string" ? language : null,
          code: codeText((child as SerializedElementNode).children ?? []),
        });
        break;
      }

      case "hr":
      case "horizontalrule":
        out.push({ _type: "horizontal-rule", _key: key() });
        break;

      default: {
        const policy = options.onUnknownNode ?? "children";
        if (policy === "throw") {
          throw new Error(
            `[lexical-portable-text] No rule or built-in mapping for node type "${child.type}".`,
          );
        }
        if (policy === "skip") break;
        if (hasChildren(child)) {
          out.push(...convertBlocks(child.children, key, options, rules, ctx));
        }
        break;
      }
    }
  }

  return out;
}
