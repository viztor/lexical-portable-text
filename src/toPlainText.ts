/**
 * Extract plain text from Portable Text blocks.
 *
 * Useful for search indexes, summaries, SEO descriptions, previews, and word counts.
 * Pure and tree-shakeable.
 */
import type { PortableTextBlock, PortableTextContent, PortableTextSpan } from "./types.js";

export interface ToPlainTextOptions {
  /** Separator inserted between top-level blocks. Defaults to "\n\n". */
  blockSeparator?: string;
  /** Whether to include code block contents. Defaults to true. */
  includeCode?: boolean;
  /** Whether to include table cell text. Defaults to true. */
  includeTables?: boolean;
}

/**
 * Convert Portable Text blocks into a plain text string.
 */
export function portableTextToPlainText(
  blocks: readonly PortableTextContent[],
  options: ToPlainTextOptions = {},
): string {
  const blockSeparator = options.blockSeparator ?? "\n\n";
  const includeCode = options.includeCode ?? true;
  const includeTables = options.includeTables ?? true;
  const parts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    if (block._type === "block") {
      const textParts: string[] = [];
      for (const child of (block as PortableTextBlock).children ?? []) {
        if (child && child._type === "span") {
          const span = child as PortableTextSpan;
          if (typeof span.text === "string" && span.text.length > 0) {
            textParts.push(span.text);
          }
        }
      }
      parts.push(textParts.join(""));
    } else if (block._type === "code" && includeCode) {
      const code = (block as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) {
        parts.push(code);
      }
    } else if (block._type === "table" && includeTables) {
      const rows = (block as { rows?: Array<{ cells?: string[] }> }).rows ?? [];
      const tableLines = rows
        .map((row) => (row.cells ?? []).join("\t"))
        .filter((line) => line.length > 0);
      if (tableLines.length > 0) {
        parts.push(tableLines.join("\n"));
      }
    }
  }

  return parts.join(blockSeparator);
}
