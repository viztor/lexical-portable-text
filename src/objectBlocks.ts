/**
 * Built-in Portable Text object blocks → Lexical nodes.
 *
 * `code`, horizontal rules, `table`, and `image` have conventional shapes
 * across the Portable Text ecosystem, so the load path handles them without
 * asking the caller for a rule. `builtinObjectBlock` returns `null` for
 * anything it does not own — including a conventional type whose factory is
 * missing — so the caller can fall through to its own `object` factory.
 */
import type { ArbitraryTypedObject } from "@portabletext/types";
import type { LexicalNode } from "lexical";

import type { LexicalNodeFactories } from "./portableTextToLexical.js";
import { textChildren } from "./textNodes.js";
import type { PortableTextContent } from "./types.js";

/**
 * Convert one of the conventional object blocks, or `null` when the block is
 * not a built-in (or its factory is absent) and the caller should keep going.
 */
export function builtinObjectBlock(
  block: PortableTextContent,
  factories: LexicalNodeFactories,
  onMissingFactory?: (kind: string, block: PortableTextContent) => void,
): LexicalNode[] | null {
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
    onMissingFactory?.("code", block);
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
    onMissingFactory?.("table", block);
    return null;
  }

  if (block._type === "image") {
    if (factories.image) {
      const img = block as Record<string, unknown>;
      const rawUrl = img.url ?? (img.asset as Record<string, unknown> | undefined)?.url;
      const url = typeof rawUrl === "string" ? rawUrl : undefined;
      const alt = typeof img.alt === "string" ? img.alt : undefined;
      const title = typeof img.title === "string" ? img.title : undefined;
      const caption = typeof img.caption === "string" ? img.caption : undefined;
      const width = typeof img.width === "number" ? img.width : undefined;
      const height = typeof img.height === "number" ? img.height : undefined;
      return [
        factories.image(block as ArbitraryTypedObject, { url, alt, title, caption, width, height }),
      ];
    }
    onMissingFactory?.("image", block);
    return null;
  }

  return null;
}
