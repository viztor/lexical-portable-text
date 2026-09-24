/**
 * Lexical text-format bitmask ↔ Portable Text decorators.
 *
 * Lexical packs decorators into a single bitmask on each text node, while
 * Portable Text uses a `marks: string[]` list per span. Ported from
 * Lexical's `IS_BOLD`/`IS_ITALIC`/`…` constants so this package never imports
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
 * `code`). Sub/superscript and highlight have no single ecosystem standard
 * and are opt-in or recognized via aliases.
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

/**
 * Well-known mark aliases found across Portable Text tools (Sanity Studio,
 * markdown converters, HTML serializers).
 */
export const WELL_KNOWN_MARK_ALIASES: Readonly<Record<string, LexicalDecorator>> = {
  strong: "bold",
  bold: "bold",
  b: "bold",
  em: "italic",
  italic: "italic",
  i: "italic",
  "strike-through": "strikethrough",
  strikethrough: "strikethrough",
  strike: "strikethrough",
  s: "strikethrough",
  underline: "underline",
  u: "underline",
  code: "code",
  sub: "subscript",
  subscript: "subscript",
  sup: "superscript",
  superscript: "superscript",
  highlight: "highlight",
  mark: "highlight",
};

export interface MarkMappingOptions {
  /** Override the decorator name per Lexical decorator. `null` drops it. */
  names?: Partial<Record<LexicalDecorator, string | null>>;
  /** Called for decorators that have no mark name (dropped data). */
  onUnmapped?: (decorator: LexicalDecorator, format: number) => void;
  /**
   * Whether to recognize well-known decorator aliases (e.g. "strikethrough",
   * "bold", "italic", "sub", "sup", "highlight") when converting marks to format.
   * Defaults to true.
   */
  parseAliases?: boolean;
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
  const parseAliases = options?.parseAliases ?? true;
  let format = 0;

  for (const mark of marks) {
    let matched = false;
    for (const decorator of Object.keys(LEXICAL_FORMAT) as LexicalDecorator[]) {
      if (names[decorator] === mark) {
        format |= LEXICAL_FORMAT[decorator];
        matched = true;
      }
    }

    if (!matched && parseAliases) {
      const aliasDecorator = WELL_KNOWN_MARK_ALIASES[mark];
      if (aliasDecorator) {
        // Only apply alias if user hasn't explicitly remapped or nulled this decorator
        const userProvided =
          options?.names && Object.prototype.hasOwnProperty.call(options.names, aliasDecorator);
        if (!userProvided) {
          format |= LEXICAL_FORMAT[aliasDecorator];
        }
      }
    }
  }

  return format;
}
