/**
 * Text → Lexical text-node helper shared by the load path.
 *
 * Portable Text carries newlines inside a single span or code value, while
 * Lexical wants an explicit linebreak node between text runs.
 */
import type { LexicalNode } from "lexical";

import type { LexicalNodeFactories } from "./portableTextToLexical.js";

/** Split a text value into text nodes, inserting a linebreak per `\n`. */
export function textChildren(
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
