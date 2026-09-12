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
 * object blocks (`code`, `image`, custom `_type`s).
 */
export type PortableTextContent = PortableTextBlock | PortableTextObjectBlock;

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
}

export interface SerializedTextNode extends SerializedLexicalNode {
  text: string;
  /** Lexical text-format bitmask (bold=1, italic=2, …). */
  format: number;
}

export interface SerializedLinkNode extends SerializedElementNode {
  url: string;
}

/** Anything that can produce a serialized state: state JSON or an editor. */
export type LexicalStateInput =
  | SerializedLexicalState
  | { getEditorState(): { toJSON(): SerializedLexicalState } };

export type KeyGenerator = () => string;

/** Returned by rules; `null` means "fall back to default handling". */
export type RuleResult<T> = T | null;
