/**
 * Built-in Portable Text object blocks → Lexical nodes.
 *
 * `code`, horizontal rules, `table`, and `image` have conventional shapes
 * across the Portable Text ecosystem, so the load path handles them without
 * asking the caller for a rule. `builtinObjectBlock` returns `null` when the
 * caller should keep looking — an unrecognised type, or `table`/`image` with
 * no factory configured. `code` and the horizontal-rule aliases always
 * return: `code` falls back to a paragraph when its factory is missing, and a
 * horizontal rule with no factory yields `[]` rather than falling through to
 * the `object` factory.
 *
 * The options object (not a bare callback) is passed so `onMissingFactory` is
 * invoked as a method, matching every other call site in the load path.
 */
import type { ArbitraryTypedObject } from "@portabletext/types";
import type { LexicalNode } from "lexical";

import type { PortableTextToLexicalOptions } from "./portableTextToLexical.js";
import { textChildren } from "./textNodes.js";
import type { PortableTextContent } from "./types.js";

/**
 * Convert one of the conventional object blocks, or `null` when the block is
 * not a built-in (or its factory is absent) and the caller should keep going.
 */
export function builtinObjectBlock(
  block: PortableTextContent,
  options: PortableTextToLexicalOptions,
): LexicalNode[] | null {
  const { factories } = options;
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
    options.onMissingFactory?.("table", block);
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
    options.onMissingFactory?.("image", block);
    return null;
  }

  return null;
}
