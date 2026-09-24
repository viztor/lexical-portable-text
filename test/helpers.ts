/**
 * Shared fixtures + a headless Lexical editor wired with the standard node
 * set, mirroring how an app would call the converter.
 */
import { CodeHighlightNode, CodeNode, $createCodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode, $createLinkNode } from "@lexical/link";
import { ListItemNode, ListNode, $createListItemNode, $createListNode } from "@lexical/list";
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import type {
  LexicalNodeFactories,
  SerializedLexicalNode,
  SerializedLexicalState,
} from "../src/index.js";

// ── Lexical serialized fixtures (save-path inputs) ──────────────────────────

export const text = (value: string, format = 0): SerializedLexicalNode => ({
  type: "text",
  version: 1,
  text: value,
  format,
  detail: 0,
  mode: "normal",
  style: "normal",
});

export const paragraph = (...children: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "paragraph",
  version: 1,
  children,
});

export const heading = (
  tag: string,
  ...children: SerializedLexicalNode[]
): SerializedLexicalNode => ({ type: "heading", version: 1, tag, children });

export const quote = (...children: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "quote",
  version: 1,
  children,
});

export const list = (
  listType: string,
  ...children: SerializedLexicalNode[]
): SerializedLexicalNode => ({
  type: "list",
  version: 1,
  listType,
  children,
});

export const listItem = (...children: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "listitem",
  version: 1,
  value: 1,
  children,
});

export const checkListItem = (
  checked: boolean,
  ...children: SerializedLexicalNode[]
): SerializedLexicalNode => ({
  type: "listitem",
  version: 1,
  value: 1,
  checked,
  children,
});

export const code = (language: string | null, value: string): SerializedLexicalNode => ({
  type: "code",
  version: 1,
  language,
  children: [{ type: "code-highlight", version: 1, text: value, format: 0 }],
});

export const codeWithFilename = (
  language: string | null,
  value: string,
  filename?: string,
): SerializedLexicalNode => ({
  type: "code",
  version: 1,
  language,
  filename,
  children: [{ type: "code-highlight", version: 1, text: value, format: 0 }],
});

export const link = (url: string, ...children: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "link",
  version: 1,
  url,
  children,
});

export const autolink = (
  url: string,
  ...children: SerializedLexicalNode[]
): SerializedLexicalNode => ({
  type: "autolink",
  version: 1,
  url,
  children,
});

export const linkWithMeta = (
  url: string,
  meta: { title?: string; target?: string; rel?: string },
  ...children: SerializedLexicalNode[]
): SerializedLexicalNode => ({
  type: "link",
  version: 1,
  url,
  ...meta,
  children,
});

export const table = (...rows: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "table",
  version: 1,
  children: rows,
});

export const tableRow = (...cells: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "tablerow",
  version: 1,
  children: cells,
});

export const tableCell = (...children: SerializedLexicalNode[]): SerializedLexicalNode => ({
  type: "tablecell",
  version: 1,
  children,
});

export const linebreak = (): SerializedLexicalNode => ({
  type: "linebreak",
  version: 1,
});

export const horizontalRule = (type = "hr"): SerializedLexicalNode => ({
  type,
  version: 1,
});

export const state = (...children: SerializedLexicalNode[]): SerializedLexicalState => ({
  root: { type: "root", version: 1, children },
});

/** `state()` with a root that has no children key at all (defensive input). */
export const emptyState = (): SerializedLexicalState =>
  ({ root: { type: "root", version: 1 } }) as SerializedLexicalState;

// ── Headless editor + factories (load-path inputs) ──────────────────────────

export function makeEditor(extraNodes: Array<Klass<LexicalNode>> = []): LexicalEditor {
  return createHeadlessEditor({
    namespace: "lexical-portable-text-test",
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      CodeHighlightNode,
      ...extraNodes,
    ],
    onError: (error) => {
      throw error;
    },
  });
}

/** The full factory set an app would wire for the standard node kit. */
export const factories: LexicalNodeFactories = {
  text: (value, format) => $createTextNode(value).setFormat(format),
  paragraph: (children) => $createParagraphNode().append(...children),
  heading: (tag, children) => $createHeadingNode(tag).append(...children),
  quote: (children) => $createQuoteNode().append(...children),
  list: (listType, children) => $createListNode(listType).append(...children),
  listItem: (children, meta) => $createListItemNode(meta.checked).append(...children),
  code: (language, children) => $createCodeNode(language ?? undefined).append(...children),
  link: (url, children, meta) => {
    const attrs = meta ? { target: meta.target, rel: meta.rel, title: meta.title } : undefined;
    return $createLinkNode(url, attrs).append(...children);
  },
  linebreak: () => $createLineBreakNode(),
};

/** Factories without the optional element kinds, for fallback tests. */
export const minimalFactories: LexicalNodeFactories = {
  text: (value, format) => $createTextNode(value).setFormat(format),
  paragraph: (children) => $createParagraphNode().append(...children),
};

/** Deterministic keys so assertions can ignore them cleanly. */
export function counterKeys(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `k${index}`;
  };
}

/** Recursively drop `_key` fields for structural comparisons. */
export function stripKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripKeys(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "_key") continue;
      output[key] = stripKeys(entry);
    }
    return output as T;
  }
  return value;
}

/**
 * Normalizes Portable Text for round-trip comparison:
 * - drops `_key`s
 * - rewrites mark references to stable tokens (`link:https://…`)
 */
export function canonicalize(blocks: unknown): unknown {
  const cloned = JSON.parse(JSON.stringify(blocks)) as Array<Record<string, unknown>>;
  for (const block of cloned) {
    const definitions = (block.markDefs ?? []) as Array<Record<string, unknown>>;
    const markMap = new Map<string, string>(
      definitions.map((def) => [
        String(def._key),
        `${String(def._type)}:${String(def.href ?? "")}`,
      ]),
    );
    for (const child of (block.children ?? []) as Array<Record<string, unknown>>) {
      if (Array.isArray(child.marks)) {
        child.marks = (child.marks as string[]).map((mark) => markMap.get(mark) ?? mark).sort();
      }
    }
  }
  return stripKeys(cloned);
}

// ── Read helpers ────────────────────────────────────────────────────────────

export function rootChildren(editor: LexicalEditor): Array<Record<string, unknown>> {
  return editor.getEditorState().toJSON().root.children as unknown as Array<
    Record<string, unknown>
  >;
}

export function childAt(editor: LexicalEditor, index: number): Record<string, unknown> | undefined {
  return rootChildren(editor)[index];
}

/** Concatenate the `text` fields of a serialized node tree. */
export function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (record.type === "linebreak") return "\n";
  let out = typeof record.text === "string" ? record.text : "";
  if (Array.isArray(record.children)) {
    for (const child of record.children) out += textOf(child);
  }
  return out;
}

/** Depth-first collect serialized nodes of a given `type`. */
export function collect(node: unknown, type: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  if (record.type === type) out.push(record);
  if (Array.isArray(record.children)) {
    for (const child of record.children) out.push(...collect(child, type));
  }
  return out;
}
