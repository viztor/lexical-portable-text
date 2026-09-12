import { describe, expect, it, vi } from "vitest";

import {
  lexicalToPortableText,
  portableTextToLexical,
  type PortableTextContent,
  type PortableTextSpan,
} from "../src/index.js";
import { CalloutNode, calloutLoad, calloutSave } from "./callout.js";
import { canonicalize, factories, makeEditor } from "./helpers.js";

let counter = 0;
const key = (): string => `r${(counter += 1)}`;
const span = (text: string, marks: string[] = []): PortableTextSpan => ({
  _type: "span",
  _key: key(),
  text,
  marks,
});
const block = (
  children: PortableTextSpan[],
  extra: Partial<PortableTextContent> = {},
): PortableTextContent =>
  ({
    _type: "block",
    _key: key(),
    style: "normal",
    children,
    ...extra,
  }) as PortableTextContent;

const calloutOptions = {
  load: calloutLoad,
  save: calloutSave,
};

function roundTrip(
  blocks: readonly PortableTextContent[],
  options: {
    load?: Parameters<typeof portableTextToLexical>[2];
    save?: Parameters<typeof lexicalToPortableText>[1];
  } = {},
): PortableTextContent[] {
  const editor = makeEditor([CalloutNode]);
  portableTextToLexical(editor, blocks, options.load ?? { factories });
  return lexicalToPortableText(editor, options.save ?? {}) as PortableTextContent[];
}

describe("round-trip: Portable Text → Lexical → Portable Text", () => {
  const cases: Array<{ name: string; blocks: PortableTextContent[] }> = [
    {
      name: "plain paragraphs",
      blocks: [block([span("Hello")]), block([span("World")])],
    },
    {
      name: "decorators",
      blocks: [
        block([
          span("plain "),
          span("bold", ["strong"]),
          span(" and "),
          span("em", ["em"]),
          span(" and "),
          span("styled", ["strong", "em", "underline", "strike-through", "code"]),
        ]),
      ],
    },
    {
      name: "links",
      blocks: [
        block([span("see "), span("docs", ["l1"])], {
          markDefs: [{ _type: "link", _key: "l1", href: "https://x.dev" }],
        }),
      ],
    },
    {
      name: "headings and quotes",
      blocks: [
        block([span("Title")], { style: "h1" }),
        block([span("Section")], { style: "h3" }),
        block([span("Quoted")], { style: "blockquote" }),
      ],
    },
    {
      name: "nested lists",
      blocks: [
        block([span("One")], { listItem: "bullet", level: 1 }),
        block([span("Two")], { listItem: "bullet", level: 1 }),
        block([span("Nested")], { listItem: "number", level: 2 }),
      ],
    },
    {
      name: "code blocks",
      blocks: [{ _type: "code", _key: key(), language: "ts", code: "const a = 1;\n" }],
    },
    {
      name: "hard breaks",
      blocks: [block([span("first\nsecond\n")])],
    },
    {
      name: "a mixed document",
      blocks: [
        block([span("Doc")], { style: "h2" }),
        block([span("Intro "), span("with emphasis", ["em"])]),
        block([span("Item")], { listItem: "bullet", level: 1 }),
        block([span("Item two")], { listItem: "bullet", level: 2 }),
        { _type: "code", _key: key(), language: null, code: "x()" },
        block([span("Outro")]),
      ],
    },
    {
      name: "an empty paragraph",
      blocks: [block([])],
    },
    {
      name: "one mark definition shared by several spans",
      blocks: [
        block([span("bold link", ["l1", "strong"]), span(" plain link", ["l1"])], {
          markDefs: [{ _type: "link", _key: "l1", href: "https://x.dev" }],
        }),
      ],
    },
    {
      name: "consecutive code blocks",
      blocks: [
        { _type: "code", _key: key(), language: "ts", code: "a()" },
        { _type: "code", _key: key(), language: null, code: "b()" },
      ],
    },
  ];

  it.each(cases)("$name round-trips and is idempotent", ({ blocks }) => {
    const first = roundTrip(blocks);
    expect(canonicalize(first)).toEqual(canonicalize(blocks));

    const second = roundTrip(first);
    expect(canonicalize(second)).toEqual(canonicalize(first));
  });

  it("documents the lossy check-list mapping (task list → bullet)", () => {
    const source = [
      block([span("Done")], {
        listItem: "check",
        level: 1,
        checked: true,
      } as Partial<PortableTextContent>),
    ];
    const result = roundTrip(source);
    expect(result[0]).toMatchObject({ listItem: "bullet" });
    expect(result[0]).not.toHaveProperty("checked");
  });

  it("round-trips a custom Callout block through rules and factories", () => {
    const callouts: PortableTextContent[] = [{ _type: "callout", _key: key(), tone: "warning" }];

    const first = roundTrip(callouts, calloutOptions);
    expect(canonicalize(first)).toEqual(canonicalize(callouts));

    const second = roundTrip(first, calloutOptions);
    expect(canonicalize(second)).toEqual(canonicalize(first));
  });

  it("does not report missing factories for handled custom blocks", () => {
    const onMissingFactory = vi.fn();
    const editor = makeEditor([CalloutNode]);
    portableTextToLexical(editor, [{ _type: "callout", _key: key(), tone: "tip" }], {
      ...calloutLoad,
      onMissingFactory,
    });
    expect(onMissingFactory).not.toHaveBeenCalled();
    expect(lexicalToPortableText(editor, calloutSave) as PortableTextContent[]).toMatchObject([
      { _type: "callout", tone: "tip" },
    ]);
  });
});
