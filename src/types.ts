/**
 * Shared types. Portable Text shapes come from the official
 * `@portabletext/types` package so this package speaks the same dialects as
 * the rest of the ecosystem (`@portabletext/markdown`, `-to-html`, `-react`).
 *
 * Lexical serialized state is typed structurally (a subset of the real
 * shapes) so the save path never needs a Lexical runtime.
 */
import type {
  ArbitraryTypedObject,
  PortableTextBlock,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from "@portabletext/types";

export type {
  ArbitraryTypedObject,
  PortableTextBlock,
  PortableTextMarkDefinition,
  PortableTextSpan,
};

/** A custom (non-text) Portable Text block, e.g. `{_type: "callout", …}`. */
export type PortableTextObjectBlock = ArbitraryTypedObject;

/**
 * Any block in a Portable Text array: text blocks (`_type: "block"`) and
 * object blocks (`code`, `image`, `table`, custom `_type`s).
 */
export type PortableTextContent = PortableTextBlock | PortableTextObjectBlock;

/** Standard Portable Text link mark definition with common metadata. */
export interface PortableTextLinkMarkDefinition extends PortableTextMarkDefinition {
  _type: "link";
  href: string;
  title?: string;
  target?: string;
  rel?: string;
  [key: string]: unknown;
}

/** Standard Portable Text table row. */
export interface PortableTextTableRow extends ArbitraryTypedObject {
  _type: "tableRow";
  cells: string[];
}

/** Standard Portable Text table block. */
export interface PortableTextTableBlock extends ArbitraryTypedObject {
  _type: "table";
  rows: PortableTextTableRow[];
}

/** Standard Portable Text image block. */
export interface PortableTextImageBlock extends ArbitraryTypedObject {
  _type: "image";
  url?: string;
  asset?: { _ref?: string; [key: string]: unknown };
  alt?: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/** Minimal structural view of Lexical's serialized editor state. */
export interface SerializedLexicalState {
  root: SerializedElementNode;
}

export interface SerializedLexicalNode {
  type: string;
  version: number;
  [key: string]: unknown;
}

export interface SerializedElementNode extends SerializedLexicalNode {
  children: SerializedLexicalNode[];
  format?: string | number;
  indent?: number;
  direction?: "ltr" | "rtl" | null;
}

export interface SerializedTextNode extends SerializedLexicalNode {
  text: string;
  /** Lexical text-format bitmask (bold=1, italic=2, …). */
  format: number;
  style?: string;
  detail?: number;
  mode?: string;
}

export interface SerializedLinkNode extends SerializedElementNode {
  url: string;
  title?: string | null;
  target?: string | null;
  rel?: string | null;
}

export interface SerializedListItemNode extends SerializedElementNode {
  value?: number;
  checked?: boolean;
}

export interface SerializedCodeNode extends SerializedElementNode {
  language?: string | null;
  filename?: string | null;
}

export interface SerializedImageNode extends SerializedLexicalNode {
  type: "image";
  src: string;
  altText?: string;
  title?: string;
  caption?: string;
  width?: number;
  height?: number;
}

/** Anything that can produce a serialized state: state JSON, single element node, array of nodes, or an editor. */
export type LexicalStateInput =
  | SerializedLexicalState
  | SerializedElementNode
  | SerializedLexicalNode[]
  | { getEditorState(): { toJSON(): SerializedLexicalState } }
  | { toJSON(): SerializedLexicalState };

export type KeyGenerator = () => string;

/** Returned by rules; `null` means "fall back to default handling". */
export type RuleResult<T> = T | null;
