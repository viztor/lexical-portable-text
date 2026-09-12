/**
 * Lexical text-format bitmask ↔ Portable Text decorators.
 *
 * Lexical packs decorators into a single bitmask on each text node, while
 * Portable Text uses a `marks: string[]` list per span. Ported from
 * Lexical's `IS_BOLD`/`IS_ITALIC`/… constants so this package never imports
 * the (version-sensitive) editor runtime on the save path.
 */

export const LEXICAL_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
} as const;

export type LexicalDecorator = keyof typeof LEXICAL_FORMAT;

/**
 * Default decorator names, matching the Portable Text conventions used by
 * `@portabletext/markdown` (`strong`, `em`, `strike-through`, `underline`,
 * `code`). Sub/superscript have no ecosystem default and are opt-in.
 */
export const DEFAULT_MARK_NAMES: Record<LexicalDecorator, string | null> = {
  bold: "strong",
  italic: "em",
  strikethrough: "strike-through",
  underline: "underline",
  code: "code",
  subscript: null,
  superscript: null,
  highlight: null,
};

export interface MarkMappingOptions {
  /** Override the decorator name per Lexical decorator. `null` drops it. */
  names?: Partial<Record<LexicalDecorator, string | null>>;
  /** Called for decorators that have no mark name (dropped data). */
  onUnmapped?: (decorator: LexicalDecorator, format: number) => void;
}

function resolveNames(options?: MarkMappingOptions): Record<LexicalDecorator, string | null> {
  const names = { ...DEFAULT_MARK_NAMES, ...options?.names };
  // Two decorators mapping to the same Portable Text mark would make the
  // mapping ambiguous (marksToFormat would set both bits). Fail loudly.
  const seen = new Set<string>();
  for (const name of Object.values(names)) {
    if (name === null) continue;
    if (seen.has(name)) {
      throw new Error(
        `[lexical-portable-text] Duplicate mark name "${name}" — remap or null out one of the decorators.`,
      );
    }
    seen.add(name);
  }
  return names;
}

/** Bitmask → decorator names, in declaration order. */
export function formatToMarks(format: number, options?: MarkMappingOptions): string[] {
  const names = resolveNames(options);
  const marks: string[] = [];
  for (const decorator of Object.keys(LEXICAL_FORMAT) as LexicalDecorator[]) {
    const bit = LEXICAL_FORMAT[decorator];
    if ((format & bit) === 0) continue;
    const name = names[decorator];
    if (name === null) {
      options?.onUnmapped?.(decorator, format);
      continue;
    }
    marks.push(name);
  }
  return marks;
}

/** Decorator names → bitmask (unknown mark names are ignored). */
export function marksToFormat(marks: readonly string[], options?: MarkMappingOptions): number {
  const names = resolveNames(options);
  let format = 0;
  for (const mark of marks) {
    for (const decorator of Object.keys(LEXICAL_FORMAT) as LexicalDecorator[]) {
      if (names[decorator] === mark) {
        format |= LEXICAL_FORMAT[decorator];
      }
    }
  }
  return format;
}
