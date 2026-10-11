/**
 * Serialized-node helpers for the save path.
 *
 * Lexical's serialized state is a plain JSON tree, so these read it
 * structurally: `hasChildren` recognises element nodes, `codeText` flattens
 * the text of a code/cell subtree, and `builtinBlockNode` maps the block types
 * that have a conventional Portable Text shape (`code`, horizontal rules,
 * `image`, `table`) without asking the caller for a rule.
 */
import type { ArbitraryTypedObject } from "@portabletext/types";

import type {
  KeyGenerator,
  PortableTextContent,
  PortableTextTableRow,
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedTextNode,
} from "./types.js";

/** Element nodes are the ones carrying a `children` array. */
export function hasChildren(node: SerializedLexicalNode): node is SerializedElementNode {
  return Array.isArray((node as SerializedElementNode).children);
}

/** Flatten a Lexical code or table-cell subtree into its text. */
export function codeText(children: readonly SerializedLexicalNode[]): string {
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

/**
 * Convert a block node with a conventional Portable Text shape, or `null`
 * when the type is not one of them and the caller should apply its own
 * unknown-node policy.
 */
export function builtinBlockNode(
  child: SerializedLexicalNode,
  key: KeyGenerator,
): PortableTextContent | null {
  switch (child.type) {
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
      return block;
    }

    case "hr":
    case "horizontalrule":
    case "horizontal-rule":
      return { _type: "horizontal-rule", _key: key() };

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
      return block;
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
      return {
        _type: "table",
        _key: tableKey,
        rows,
      };
    }

    default:
      return null;
  }
}
