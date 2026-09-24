/**
 * Lexical serialized state → Portable Text.
 *
 * Design notes (learned from the existing converters):
 * - Rules are keyed by the Lexical node `type` string and may return `null`
 *   to fall back to default handling — the same escape hatch
 *   `@lexical/markdown` transformers use.
 * - Rules apply to both block-level and inline-level nodes (e.g. mentions,
 *   badges, inline images, custom decorators).
 * - Checklists can map to standard `"bullet"` (PT default) or `"check"` with
 *   `checked: boolean` via `checkListMapping: "check"`.
 * - Links and autolinks preserve url/href, title, target, and rel metadata.
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
  PortableTextLinkMarkDefinition,
  PortableTextTableRow,
  RuleResult,
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedLexicalState,
  SerializedLinkNode,
  SerializedTextNode,
} from "./types.js";

export interface LexicalToPortableTextContext {
  key: KeyGenerator;
  options: ConverterOptions;
  /** Convert child nodes as inline content (spans + mark definitions + inline objects). */
  convertInline(children: SerializedLexicalNode[]): InlineConversion;
  /** Convert child nodes as block content. */
  convertBlocks(children: SerializedLexicalNode[]): PortableTextContent[];
}

export interface LexicalToPortableTextRule {
  /** Lexical node `type` this rule handles (e.g. `"callout"`, inline `"mention"`, `"table"`). */
  type: string;
  /** Return block(s) or inline object(s), or `null` to fall back to default handling. */
  toPortableText(
    node: SerializedLexicalNode,
    context: LexicalToPortableTextContext,
  ): RuleResult<
    PortableTextContent | PortableTextContent[] | ArbitraryTypedObject | ArbitraryTypedObject[]
  >;
}

export interface LexicalToPortableTextAnnotationRule {
  /** Lexical node `type` this rule handles (e.g. `"comment"`, `"internalLink"`). */
  type: string;
  /**
   * Return the Portable Text mark definition for this annotation, or `null`
   * to fall back to default handling (children salvaged, no mark emitted).
   */
  toPortableText(
    node: SerializedLexicalNode,
    context: LexicalToPortableTextContext,
  ): RuleResult<PortableTextMarkDefinition>;
}

export interface ConverterOptions extends MarkMappingOptions {
  /** Override Portable Text key generation. */
  keyGenerator?: KeyGenerator;
  /** Custom node rules. Built-in node types are handled either way. */
  rules?: LexicalToPortableTextRule[];
  /**
   * Save-side custom annotation rules: map a non-link Lexical wrapper node
   * (e.g. `comment`, `mention-inline`) onto a Portable Text mark definition
   * (`markDefs`), marking its child spans by key. The mirror of
   * `portableTextToLexical`'s `annotationRules`.
   */
  annotationRules?: LexicalToPortableTextAnnotationRule[];
  /**
   * What to do with a node that has no rule and no built-in mapping.
   * - `"children"` (default): recurse, keeping child content
   * - `"skip"`: drop the node
   * - `"throw"`: fail loudly (strict pipelines)
   */
  onUnknownNode?: "children" | "skip" | "throw";
  /**
   * How to map Lexical checklist items (`listType: "check"`).
   * - `"bullet"` (default): map to `listItem: "bullet"` (matches Sanity's standard Portable Text schema)
   * - `"check"`: map to `listItem: "check"` and preserve `checked: boolean`
   */
  checkListMapping?: "bullet" | "check";
  /**
   * Preserve block text alignment (`format`: "left" | "center" | "right" | "justify")
   * on the resulting Portable Text blocks. Defaults to false.
   */
  preserveFormat?: boolean;
  /**
   * Preserve block indentation level (`indent`: number) on the resulting
   * Portable Text blocks. Defaults to false.
   */
  preserveIndent?: boolean;
  /**
   * Preserve block text direction (`direction`: "ltr" | "rtl") on the resulting
   * Portable Text blocks. Defaults to false.
   */
  preserveDirection?: boolean;
  /**
   * Whether to insert an empty span `{ _type: "span", text: "", marks: [] }`
   * when a block has no children, for compatibility with Sanity Studio schema
   * validation that requires at least one child span. Defaults to false.
   */
  blankSpanOnEmptyBlock?: boolean;
}

interface InlineConversion {
  children: (PortableTextSpan | ArbitraryTypedObject)[];
  markDefs: PortableTextMarkDefinition[];
  /** Keys of link mark definitions, so breaks stay outside linked runs. */
  linkKeys: Set<string>;
}

const HEADING_STYLES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function isEditor(
  input: LexicalStateInput,
): input is { getEditorState(): { toJSON(): SerializedLexicalState } } {
  return typeof (input as { getEditorState?: unknown }).getEditorState === "function";
}

function isToJSON(input: LexicalStateInput): input is { toJSON(): SerializedLexicalState } {
  return typeof (input as { toJSON?: unknown }).toJSON === "function";
}

function extractChildren(input: LexicalStateInput): readonly SerializedLexicalNode[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  if (isEditor(input)) {
    const state = input.getEditorState().toJSON();
    return (state as { root?: SerializedElementNode }).root?.children ?? [];
  }
  if (isToJSON(input)) {
    const state = input.toJSON();
    return (state as { root?: SerializedElementNode }).root?.children ?? [];
  }
  if ("root" in input && (input as { root?: SerializedElementNode }).root) {
    return (input as { root: SerializedElementNode }).root.children ?? [];
  }
  if ("children" in input && Array.isArray((input as SerializedElementNode).children)) {
    return [input as SerializedElementNode];
  }
  if ("type" in input && typeof (input as SerializedLexicalNode).type === "string") {
    return [input as SerializedLexicalNode];
  }
  return [];
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
  const key = options.keyGenerator ?? randomKey;
  const rules = new Map((options.rules ?? []).map((rule) => [rule.type, rule]));
  const annotationRules = new Map((options.annotationRules ?? []).map((rule) => [rule.type, rule]));

  const context: LexicalToPortableTextContext = {
    key,
    options,
    convertInline: (children) =>
      convertInline(children, key, options, rules, annotationRules, context),
    convertBlocks: (children) =>
      convertBlocks(children, key, options, rules, annotationRules, context),
  };

  const nodes = extractChildren(input);
  return convertBlocks(nodes, key, options, rules, annotationRules, context);
}

function convertInline(
  children: readonly SerializedLexicalNode[],
  key: KeyGenerator,
  options: ConverterOptions,
  rules: Map<string, LexicalToPortableTextRule>,
  annotationRules: Map<string, LexicalToPortableTextAnnotationRule>,
  context: LexicalToPortableTextContext,
  extraMarks: readonly string[] = [],
  /** Identical link targets share one mark definition per block. */
  linkMarkKeys: Map<string, string> = new Map(),
  /** Dedupes custom annotation wrappers by their Lexical node `_key`. */
  doneAnnotationKeys: Set<string> = new Set(),
): InlineConversion {
  const conversion: InlineConversion = {
    children: [],
    markDefs: [],
    linkKeys: new Set(),
  };

  for (const child of children) {
    // Custom annotation rules take precedence over generic block/inline rules.
    const annotationRule = annotationRules.get(child.type);
    if (annotationRule && !doneAnnotationKeys.has(String(child._key))) {
      if (typeof child._key === "string" && child._key !== "") {
        doneAnnotationKeys.add(child._key);
      }
      const def = annotationRule.toPortableText(child, context);
      if (def !== null) {
        const defKey = typeof def._key === "string" && def._key !== "" ? def._key : key();
        const normalizedDef: PortableTextMarkDefinition =
          typeof def._key === "string" && def._key !== "" ? def : { ...def, _key: defKey };
        conversion.markDefs.push(normalizedDef);
        const nested = convertInline(
          (child as SerializedElementNode).children ?? [],
          key,
          options,
          rules,
          annotationRules,
          context,
          [...extraMarks, defKey],
          linkMarkKeys,
          doneAnnotationKeys,
        );
        conversion.children.push(...nested.children);
        conversion.markDefs.push(...nested.markDefs);
        for (const nestedKey of nested.linkKeys) {
          conversion.linkKeys.add(nestedKey);
        }
        continue;
      }
      // Rule returned null → fall through to generic handling below.
    }

    // Check if an inline rule matches this node
    const rule = rules.get(child.type);
    if (rule) {
      const result = rule.toPortableText(child, context);
      if (result !== null) {
        const items = Array.isArray(result) ? result : [result];
        for (const item of items) {
          if (item && typeof item === "object") {
            const inlineObj = { ...item } as ArbitraryTypedObject;
            if (!inlineObj._key) {
              inlineObj._key = key();
            }
            conversion.children.push(inlineObj);
          }
        }
        continue;
      }
    }

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

    if (child.type === "link" || child.type === "autolink") {
      const link = child as SerializedLinkNode;
      const url = link.url ?? (link as { href?: unknown }).href;
      const title = typeof link.title === "string" && link.title ? link.title : undefined;
      const target = typeof link.target === "string" && link.target ? link.target : undefined;
      const rel = typeof link.rel === "string" && link.rel ? link.rel : undefined;

      const signature = JSON.stringify([url ?? null, title ?? null, target ?? null, rel ?? null]);
      let markKey = linkMarkKeys.get(signature);
      if (markKey === undefined) {
        markKey = key();
        linkMarkKeys.set(signature, markKey);
        conversion.linkKeys.add(markKey);
        const def: PortableTextLinkMarkDefinition = {
          _type: "link",
          _key: markKey,
          href: url as string,
        };
        if (title !== undefined) def.title = title;
        if (target !== undefined) def.target = target;
        if (rel !== undefined) def.rel = rel;
        conversion.markDefs.push(def);
      }
      const nested = convertInline(
        link.children ?? [],
        key,
        options,
        rules,
        annotationRules,
        context,
        [...extraMarks, markKey],
        linkMarkKeys,
        doneAnnotationKeys,
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
      const nested = convertInline(
        child.children,
        key,
        options,
        rules,
        annotationRules,
        context,
        extraMarks,
        linkMarkKeys,
        doneAnnotationKeys,
      );
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
  rules: Map<string, LexicalToPortableTextRule>,
  annotationRulesParam: Map<string, LexicalToPortableTextAnnotationRule>,
  context: LexicalToPortableTextContext,
  extra?: Partial<PortableTextBlock> & Record<string, unknown>,
  node?: SerializedLexicalNode,
): PortableTextBlock {
  // Block key is allocated before its children so keys read in document order.
  const blockKey = key();
  const inline = convertInline(
    children,
    key,
    options,
    rules,
    annotationRulesParam,
    context,
    [],
    new Map(),
  );
  const block: PortableTextBlock & Record<string, unknown> = {
    _type: "block",
    _key: blockKey,
    style,
    children: inline.children,
    ...extra,
  };
  if (inline.markDefs.length > 0) block.markDefs = inline.markDefs;

  if (options.preserveFormat && node) {
    const format = (node as SerializedElementNode).format;
    if (typeof format === "string" && format !== "") {
      block.format = format;
    }
  }

  if (options.preserveIndent && node) {
    const indent = (node as SerializedElementNode).indent;
    if (typeof indent === "number" && indent > 0) {
      block.indent = indent;
    }
  }

  if (options.preserveDirection && node) {
    const direction = (node as SerializedElementNode).direction;
    if (direction === "ltr" || direction === "rtl") {
      block.direction = direction;
    }
  }

  if (options.blankSpanOnEmptyBlock && block.children.length === 0) {
    block.children.push({
      _type: "span",
      _key: key(),
      text: "",
      marks: [],
    });
  }

  return block;
}

function listItemType(
  listType: unknown,
  checkListMapping?: "bullet" | "check",
): "bullet" | "number" | "check" {
  if (listType === "number") return "number";
  if (listType === "check") return checkListMapping === "check" ? "check" : "bullet";
  return "bullet";
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
  rules: Map<string, LexicalToPortableTextRule>,
  annotationRulesParam: Map<string, LexicalToPortableTextAnnotationRule>,
  context: LexicalToPortableTextContext,
  out: PortableTextContent[],
  listType: unknown,
  level: number,
): void {
  const type = listItemType(listType, options.checkListMapping);
  for (const item of node.children ?? []) {
    if (item.type !== "listitem") {
      out.push(...convertBlocks([item], key, options, rules, annotationRulesParam, context));
      continue;
    }
    const { inline, nested } = splitListItem(item as SerializedElementNode);
    const itemChecked = (item as { checked?: unknown }).checked;
    const extra: Partial<PortableTextBlock> & Record<string, unknown> = {
      listItem: type,
      level,
    };
    if (type === "check") {
      extra.checked = typeof itemChecked === "boolean" ? itemChecked : false;
    } else if (options.checkListMapping === "check" && typeof itemChecked === "boolean") {
      extra.checked = itemChecked;
    }

    out.push(
      textBlock("normal", inline, key, options, rules, annotationRulesParam, context, extra, item),
    );
    for (const childList of nested) {
      convertList(
        childList,
        key,
        options,
        rules,
        annotationRulesParam,
        context,
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
  annotationRulesParam: Map<string, LexicalToPortableTextAnnotationRule>,
  context: LexicalToPortableTextContext,
): PortableTextContent[] {
  const out: PortableTextContent[] = [];

  for (const child of children) {
    const rule = rules.get(child.type);
    if (rule) {
      const result = rule.toPortableText(child, context);
      if (result !== null) {
        pushAll(out, result as PortableTextContent | PortableTextContent[]);
        continue;
      }
    }

    switch (child.type) {
      case "paragraph":
        out.push(
          textBlock(
            "normal",
            (child as SerializedElementNode).children ?? [],
            key,
            options,
            rules,
            annotationRulesParam,
            context,
            undefined,
            child,
          ),
        );
        break;

      case "heading": {
        const tag = (child as { tag?: unknown }).tag;
        const style = typeof tag === "string" && HEADING_STYLES.has(tag) ? tag : "h2";
        out.push(
          textBlock(
            style,
            (child as SerializedElementNode).children ?? [],
            key,
            options,
            rules,
            annotationRulesParam,
            context,
            undefined,
            child,
          ),
        );
        break;
      }

      case "quote":
        out.push(
          textBlock(
            "blockquote",
            (child as SerializedElementNode).children ?? [],
            key,
            options,
            rules,
            annotationRulesParam,
            context,
            undefined,
            child,
          ),
        );
        break;

      case "list":
        convertList(
          child as SerializedElementNode,
          key,
          options,
          rules,
          annotationRulesParam,
          context,
          out,
          (child as { listType?: unknown }).listType,
          1,
        );
        break;

      case "code": {
        const language = (child as { language?: unknown }).language;
        const filename = (child as { filename?: unknown }).filename;
        const block: PortableTextContent & Record<string, unknown> = {
          _type: "code",
          _key: key(),
          language: typeof language === "string" ? language : null,
          code: codeText((child as SerializedElementNode).children ?? []),
        };
        if (typeof filename === "string" && filename) {
          block.filename = filename;
        }
        out.push(block);
        break;
      }

      case "hr":
      case "horizontalrule":
      case "horizontal-rule":
        out.push({ _type: "horizontal-rule", _key: key() });
        break;

      case "image": {
        const img = child as Record<string, unknown>;
        const rawUrl = img.src ?? img.url;
        const rawAlt = img.altText ?? img.alt;
        const block: ArbitraryTypedObject = {
          _type: "image",
          _key: key(),
        };
        if (typeof rawUrl === "string" && rawUrl) block.url = rawUrl;
        if (typeof rawAlt === "string" && rawAlt) block.alt = rawAlt;
        if (typeof img.title === "string" && img.title) block.title = img.title;
        if (typeof img.caption === "string" && img.caption) block.caption = img.caption;
        if (typeof img.width === "number") block.width = img.width;
        if (typeof img.height === "number") block.height = img.height;
        if (img.asset && typeof img.asset === "object") block.asset = img.asset;
        out.push(block);
        break;
      }

      case "table": {
        const tableKey = key();
        const rows: PortableTextTableRow[] = [];
        for (const row of (child as SerializedElementNode).children ?? []) {
          if (row.type === "tablerow" || row.type === "table-row") {
            const rowKey = key();
            const cells: string[] = [];
            for (const cell of (row as SerializedElementNode).children ?? []) {
              if (cell.type === "tablecell" || cell.type === "table-cell") {
                cells.push(codeText((cell as SerializedElementNode).children ?? []));
              }
            }
            rows.push({
              _type: "tableRow",
              _key: rowKey,
              cells,
            });
          }
        }
        out.push({
          _type: "table",
          _key: tableKey,
          rows,
        });
        break;
      }

      default: {
        const policy = options.onUnknownNode ?? "children";
        if (policy === "throw") {
          throw new Error(
            `[lexical-portable-text] No rule or built-in mapping for node type "${child.type}".`,
          );
        }
        if (policy === "skip") break;
        if (hasChildren(child)) {
          out.push(
            ...convertBlocks(child.children, key, options, rules, annotationRulesParam, context),
          );
        }
        break;
      }
    }
  }

  return out;
}
