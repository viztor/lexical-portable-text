/**
 * Deterministic generators for property-based tests. Everything seeded via
 * mulberry32 so failures reproduce exactly.
 */
import type {
  PortableTextBlock,
  PortableTextContent,
  PortableTextMarkDefinition,
  PortableTextSpan,
  SerializedLexicalNode,
  SerializedLexicalState,
} from "../src/index.js";

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rand: () => number, values: readonly T[]): T =>
  values[Math.floor(rand() * values.length)]!;

const MARK_ORDER = ["strong", "em", "strike-through", "underline", "code"];

export const orderMarks = (marks: readonly string[]): string[] =>
  MARK_ORDER.filter((mark) => marks.includes(mark));

const DECORATORS = [
  [],
  ["strong"],
  ["em"],
  ["code"],
  ["strong", "em"],
  ["underline", "strike-through"],
] as const;

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "éclair",
  "漢字",
  "مرحبا",
  "🎉",
  "x",
  "'quoted'",
  "a-b_c",
] as const;

let keyCounter = 0;
export const nextKey = (): string => `g${(keyCounter += 1)}`;

export function randomSpans(rand: () => number): {
  children: PortableTextSpan[];
  markDefs: PortableTextMarkDefinition[];
} {
  const count = 1 + Math.floor(rand() * 4);
  const children: PortableTextSpan[] = [];
  const markDefs: PortableTextMarkDefinition[] = [];
  let previousMarks: string[] | null = null;

  for (let index = 0; index < count; index += 1) {
    const useLink = rand() < 0.2;
    let marks: string[] = orderMarks(pick(rand, DECORATORS));
    if (
      previousMarks !== null &&
      marks.length === previousMarks.length &&
      marks.every((mark, i) => mark === previousMarks![i])
    ) {
      // Adjacent identical marks merge at serialization time.
      marks = marks.includes("strong")
        ? marks.filter((mark) => mark !== "strong")
        : orderMarks([...marks, "strong"]);
    }

    const text = pick(rand, WORDS);
    if (useLink) {
      const markKey = nextKey();
      markDefs.push({
        _type: "link",
        _key: markKey,
        href: `https://example.com/${index}`,
      });
      const linkMarks = [markKey, ...marks];
      children.push({ _type: "span", _key: nextKey(), text, marks: linkMarks });
      previousMarks = linkMarks;
    } else {
      children.push({ _type: "span", _key: nextKey(), text, marks });
      previousMarks = marks;
    }
  }

  return { children, markDefs };
}

export interface RandomDocumentOptions {
  /** Allow custom `callout` objects in the mixture. */
  callouts?: boolean;
}

export function randomDocument(
  rand: () => number,
  options: RandomDocumentOptions = {},
): PortableTextContent[] {
  const blocks: PortableTextContent[] = [];
  const blockCount = 1 + Math.floor(rand() * 6);
  let index = 0;

  while (index < blockCount) {
    const roll = rand();

    if (options.callouts === true && roll < 0.12) {
      blocks.push({
        _type: "callout",
        _key: nextKey(),
        tone: pick(rand, ["note", "tip", "warning"] as const),
      });
      index += 1;
      continue;
    }

    if (roll < 0.15) {
      blocks.push({
        _type: "code",
        _key: nextKey(),
        language: pick(rand, [null, "ts", "js", "bash" as const]),
        code: pick(rand, ["const x = 1;", "a = 2\nb = 3", "print('hi')\n"]),
      });
      index += 1;
      continue;
    }

    if (roll < 0.55) {
      const runLength = 1 + Math.floor(rand() * 4);
      const listType = pick(rand, ["bullet", "number"] as const);
      let level = 1;
      for (let item = 0; item < runLength && index < blockCount; item += 1) {
        const { children, markDefs } = randomSpans(rand);
        const block: PortableTextBlock = {
          _type: "block",
          _key: nextKey(),
          style: "normal",
          listItem: rand() < 0.75 ? listType : pick(rand, ["bullet", "number"] as const),
          level,
          children,
        };
        if (markDefs.length > 0) block.markDefs = markDefs;
        blocks.push(block);
        level = Math.max(1, level + pick(rand, [-1, 0, 1] as const));
        index += 1;
      }
      continue;
    }

    const { children, markDefs } = randomSpans(rand);
    const style = roll < 0.7 ? "normal" : pick(rand, ["h1", "h2", "h3", "blockquote"] as const);
    const block: PortableTextBlock = {
      _type: "block",
      _key: nextKey(),
      style,
      children,
    };
    if (markDefs.length > 0) block.markDefs = markDefs;
    blocks.push(block);
    index += 1;
  }

  return blocks;
}

// ── Serialized Lexical state generator (save-path fuzz) ─────────────────────

const UNKNOWN_TYPES = ["callout", "mention", "divider", "embed", "table-cell"] as const;

function randomInlineNodes(rand: () => number): SerializedLexicalNode[] {
  const count = 1 + Math.floor(rand() * 4);
  const nodes: SerializedLexicalNode[] = [];

  for (let index = 0; index < count; index += 1) {
    const roll = rand();
    if (roll < 0.6) {
      const formatPool = [0, 1, 2, 4, 8, 16, 3, 5, 31, 32, 128];
      nodes.push({
        type: "text",
        version: 1,
        text: pick(rand, WORDS),
        format: pick(rand, formatPool),
        detail: 0,
        mode: "normal",
        style: "normal",
      });
      continue;
    }
    if (roll < 0.7) {
      nodes.push({ type: "linebreak", version: 1 });
      continue;
    }
    if (roll < 0.85) {
      nodes.push({
        type: "link",
        version: 1,
        url: `https://example.com/${index}`,
        children: [
          {
            type: "text",
            version: 1,
            text: pick(rand, WORDS),
            format: 0,
            detail: 0,
            mode: "normal",
            style: "normal",
          },
        ],
      });
      continue;
    }
    nodes.push({
      type: pick(rand, UNKNOWN_TYPES),
      version: 1,
      children: [
        {
          type: "text",
          version: 1,
          text: pick(rand, WORDS),
          format: 0,
          detail: 0,
          mode: "normal",
          style: "normal",
        },
      ],
    });
  }

  return nodes;
}

export function randomLexicalState(rand: () => number): SerializedLexicalState {
  const count = 1 + Math.floor(rand() * 5);
  const children: SerializedLexicalNode[] = [];

  for (let index = 0; index < count; index += 1) {
    const roll = rand();
    if (roll < 0.5) {
      children.push({
        type: "paragraph",
        version: 1,
        children: randomInlineNodes(rand),
      });
      continue;
    }
    if (roll < 0.62) {
      children.push({
        type: "heading",
        version: 1,
        tag: pick(rand, ["h1", "h2", "h3", "h4", "h5", "h6", "h9"]),
        children: randomInlineNodes(rand),
      });
      continue;
    }
    if (roll < 0.72) {
      children.push({
        type: "quote",
        version: 1,
        children: randomInlineNodes(rand),
      });
      continue;
    }
    if (roll < 0.84) {
      const itemCount = 1 + Math.floor(rand() * 3);
      children.push({
        type: "list",
        version: 1,
        listType: pick(rand, ["bullet", "number", "check"]),
        children: Array.from({ length: itemCount }, () => ({
          type: "listitem",
          version: 1,
          value: 1,
          children: randomInlineNodes(rand),
        })),
      });
      continue;
    }
    if (roll < 0.92) {
      children.push({
        type: "code",
        version: 1,
        language: pick(rand, [null, "ts", "bash"]),
        children: [
          {
            type: "code-highlight",
            version: 1,
            text: "const x = 1;",
            format: 0,
          },
        ],
      });
      continue;
    }
    if (roll < 0.96) {
      children.push({
        type: pick(rand, ["hr", "horizontalrule"]),
        version: 1,
      });
      continue;
    }
    children.push({
      type: pick(rand, UNKNOWN_TYPES),
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: randomInlineNodes(rand),
        },
      ],
    });
  }

  return { root: { type: "root", version: 1, children } };
}
