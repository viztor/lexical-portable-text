# lexical-portable-text

[![CI](https://github.com/viztor/lexical-portable-text/actions/workflows/ci.yml/badge.svg)](https://github.com/viztor/lexical-portable-text/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lexical-portable-text)](https://www.npmjs.com/package/lexical-portable-text)

Convert [Lexical](https://lexical.dev) editor state to and from
[Portable Text](https://portabletext.org).

- **Save path is pure** — converts serialized state without importing the
  editor runtime, so it runs in workers, servers, edge functions and tests.
- **Load path uses your nodes** — builds nodes through caller-supplied
  factories, so it never fights Lexical's version-sensitive serialized JSON.
- **Custom blocks & inline objects first-class** — rules in both directions,
  handling both block-level objects (callout, embed) and inline objects
  (mentions, badges), with delegation (`return null` → default handling) and
  content-preserving fallbacks.
- **Full feature parity** with Lexical's Markdown and HTML converters —
  task lists/checklists with `checked` status, autolinks, link metadata
  (`title`, `target`, `rel`), tables, code filenames, text alignment, and
  indents.
- **Annotations & custom mark definitions** — full support for non-link mark
  definitions (comments, footnotes, internal links, highlights) with nesting.
- **Type-correct & tree-shakeable** — pure ESM (`"sideEffects": false`),
  typed with `@portabletext/types`, the same package the rest of the ecosystem
  uses.

## Install

```bash
npm install lexical-portable-text
```

`lexical` is a peer dependency (`>=0.30.0 <1.0.0`; CI targets 0.50).

## Quick start

### Save: Lexical → Portable Text

```ts
import { lexicalToPortableText } from "lexical-portable-text";

// Either an editor instance or `editor.getEditorState().toJSON()`
const blocks = lexicalToPortableText(editor);
```

### Load: Portable Text → Lexical

```ts
import { $createTextNode, $createParagraphNode, $createLineBreakNode } from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createListNode, $createListItemNode } from "@lexical/list";
import { $createLinkNode } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import { portableTextToLexical } from "lexical-portable-text";

const factories = {
  text: (value, format) => $createTextNode(value).setFormat(format),
  paragraph: (children) => $createParagraphNode().append(...children),
  heading: (tag, children) => $createHeadingNode(tag).append(...children),
  quote: (children) => $createQuoteNode().append(...children),
  list: (listType, children) => $createListNode(listType).append(...children),
  listItem: (children, { checked }) => $createListItemNode(checked).append(...children),
  code: (language, children, meta) => $createCodeNode(language ?? undefined).append(...children),
  link: (url, children, meta) => $createLinkNode(url, meta).append(...children),
  linebreak: () => $createLineBreakNode(),
};

portableTextToLexical(editor, blocks, { factories });
```

`portableTextToLexical` performs a discrete update (synchronously readable).
Inside an existing `editor.update` context use
`portableTextToLexicalNodes(blocks, { factories })` instead.

### Custom blocks and inline objects

Rules handle both top-level blocks and inline elements (e.g. mentions, badges):

```ts
const options = {
  // Lexical node → Portable Text object
  rules: [
    {
      type: "callout",
      toPortableText: (node, ctx) => ({
        _type: "callout",
        _key: ctx.key(),
        tone: node.tone ?? "note",
        content: ctx.convertBlocks(node.children ?? []),
      }),
    },
    {
      type: "mention",
      toPortableText: (node, ctx) => ({
        _type: "mention",
        _key: ctx.key(),
        userId: node.userId,
      }),
    },
  ],
};

portableTextToLexical(editor, blocks, {
  factories: {
    ...factories,
    object: (block) =>
      block._type === "callout"
        ? $createCalloutNode(block.tone)
        : null,
  },
  rules: [
    {
      type: "callout",
      toLexical: (block) => $createCalloutNode(block.tone),
    },
    {
      type: "mention",
      toLexical: (block) => $createMentionNode(block.userId),
    },
  ],
});
```

Rules may return `null` to delegate to default handling — the same escape
hatch Lexical's own markdown transformers use.

### Bundled custom blocks: `definePipeline` (recommended)

When you control both directions, declare them **together** — one definition
object carries the shared `type` plus a `save` and a `load` half, and
`definePipeline` wires them into both converters, statically flagging any
definition that only transpiles one way:

```ts
import { definePipeline } from "lexical-portable-text";

const pipeline = definePipeline(
  [
    {
      type: "callout", // Lexical node type AND Portable Text _type
      save: (node, ctx) => ({
        _type: "callout",
        _key: ctx.key(),
        tone: node.tone ?? "note",
      }),
      load: (block) => $createCalloutNode(block.tone ?? "note"),
    },
    {
      type: "comment",
      annotation: true, // mark definition wrapper (markDefs), not a block
      save: (node, ctx) => ({ _type: "comment", _key: ctx.key(), commentId: node.commentId }),
      load: (def, children) => $createCommentNode(def.commentId).append(...children),
    },
  ],
  { factories, ...myOtherOptions },
);

pipeline.issues; // [] — one {direction, message} entry per one-sided definition
pipeline.saveOptions; // -> lexicalToPortableText
pipeline.loadOptions(factories); // -> portableTextToLexical
pipeline.verify(editor); // runs the full probe check suite from below
```

Key properties:

- **Pairing is static.** A definition with only a `save` half is flagged with
  `{ direction: "load", ... }` (and vice versa) instead of silently losing one
  direction; the half that exists is still wired and still verified.
- **Annotations vs blocks** are distinguished with `annotation: true`, which
  routes the `load` half's `def, children` signature correctly.
- **Base options merge**: your own hand-written rules, mark names, key
  generator, and `preserve*` flags are preserved — a hand rule with the same
  `type` overrides the bundled half (later-wins), and duplicate definition
  types inside one array are flagged in `issues`.
- **`verify()` always completes**: without factories it returns a failing
  `factoriesProvided` check instead of silently skipping load probes, and any
  one-sided definitions are surfaced as an `issues` check.
- **`verify()` reuses the probe system** below — one call validates the entire
  custom pipeline against the real probe document set.

### Custom mark definitions / annotations

Handle annotations (comments, internal links, footnotes) on text spans — in
**both** directions:

**Load: Portable Text → Lexical** (`annotationRules` / `factories.annotation`):

```ts
portableTextToLexical(editor, blocks, {
  factories,
  annotationRules: [
    {
      type: "internalLink",
      toLexical: (def, children) => {
        return $createInternalLinkNode(def.reference._ref).append(...children);
      },
    },
  ],
});
```

**Save: Lexical → Portable Text** (`annotationRules` on the save options):

```ts
const blocks = lexicalToPortableText(editor, {
  annotationRules: [
    {
      type: "internalLink",
      toPortableText: (node, ctx) => ({
        _type: "internalLink",
        _key: ctx.key(),
        reference: { _ref: node.reference._ref },
      }),
    },
  ],
});
```

The rule fires for each wrapper node; its inline children carry the mark key,
so annotations nest and stack with decorators exactly like links.

### Plain text extraction

Extract clean plain text from Portable Text blocks (for SEO descriptions, previews, word counts, search indexes):

```ts
import { portableTextToPlainText } from "lexical-portable-text";

const text = portableTextToPlainText(blocks);
// Output: "First paragraph\n\nSecond paragraph..."
```

## Options

### `lexicalToPortableText(input, options?)`

| Option                 | Default              | Purpose                                                        |
| ---------------------- | -------------------- | -------------------------------------------------------------- |
| `keyGenerator`         | random 12-char key   | Portable Text `_key` generation                                |
| `rules`                | `[]`                 | Custom Lexical node rules (`type`, `toPortableText`)           |
| `onUnknownNode`        | `"children"`         | `"children"` salvages content, `"skip"` drops, `"throw"` fails |
| `checkListMapping`     | `"bullet"`           | `"bullet"` for standard Sanity schemas; `"check"` for task lists |
| `preserveFormat`       | `false`              | Preserves `format` (left/center/right/justify) on block level  |
| `preserveIndent`       | `false`              | Preserves `indent` level on block level                        |
| `preserveDirection`    | `false`              | Preserves text direction (`"ltr"` or `"rtl"`) on block level   |
| `blankSpanOnEmptyBlock`| `false`              | Inserts empty span for Sanity Studio validation compliance     |
| `names` / `onUnmapped` | decorator defaults   | Remap or drop decorators (see Marks)                           |

### `portableTextToLexical(editor, blocks, options)`

| Option             | Default            | Purpose                                                    |
| ------------------ | ------------------ | ---------------------------------------------------------- |
| `factories`        | —                  | `text` + `paragraph` required; other kinds optional        |
| `rules`            | `[]`               | Custom Portable Text `_type` or `style` rules (`toLexical`) |
| `annotationRules`  | `[]`               | Custom mark definition rules (`type`, `toLexical`)         |
| `onMissingFactory` | —                  | Notification when a style/kind falls back to paragraph     |
| `names`            | decorator defaults | Mark-name remapping (must mirror the save path)            |
| `parseAliases`     | `true`             | Recognizes well-known ecosystem mark aliases (see Marks)   |

## Marks

Lexical packs decorators into a bitmask; Portable Text uses mark names.

| Lexical                             | Bit           | Default mark                 | Well-known aliases                     |
| ----------------------------------- | ------------- | ---------------------------- | -------------------------------------- |
| bold                                | 1             | `strong`                     | `bold`, `b`                          |
| italic                              | 2             | `em`                         | `italic`, `i`                        |
| strikethrough                       | 4             | `strike-through`             | `strikethrough`, `strike`, `s`       |
| underline                           | 8             | `underline`                  | `u`                                  |
| code                                | 16            | `code`                       |                                        |
| subscript                           | 32            | dropped (opt-in via `names`) | `sub`, `subscript`                   |
| superscript                         | 64            | dropped (opt-in via `names`) | `sup`, `superscript`                 |
| highlight                           | 128           | dropped (opt-in via `names`) | `highlight`, `mark`                  |

Link and autolink nodes become `link` mark definitions (`markDefs`) carrying
`href`, `title`, `target`, and `rel`; text spans reference them by key.

## Supported constructs

| Construct             | Save               | Load                        | Notes                                                              |
| --------------------- | ------------------ | --------------------------- | ------------------------------------------------------------------ |
| Paragraphs            | ✅                 | ✅                          | Text alignment (`format`) and `indent` preserved                 |
| Headings h1–h6        | ✅                 | ✅                          | Lexical `heading.tag` ↔ `style`                                    |
| Blockquotes           | ✅                 | ✅                          | `style: "blockquote"`                                             |
| Lists (bullet/number) | ✅                 | ✅                          | Flat-list blocks with `level`; nested lists regroup on load        |
| Task / Check lists    | ✅                 | ✅                          | `checkListMapping: "check"` preserves `checked: boolean`          |
| Links & Autolinks     | ✅                 | ✅                          | Preserves `href`, `title`, `target`, `rel`                     |
| Annotations           | ✅ `annotationRules` | ✅ `annotationRules`      | Custom mark definitions on save **and** load                       |
| Inline objects        | ✅ rules           | ✅ rules / `object` factory | Mentions, badges, inline images in `children`                     |
| Code blocks           | ✅                 | ✅                          | `_type: "code"` (`language`, `code`, `filename`)                 |
| Tables                | ✅                 | ✅                          | `_type: "table"` with `rows` and `cells` via table factories     |
| Images                | ✅                 | ✅ `factories.image`       | `_type: "image"` with `url`, `alt`, `title`, `caption`, dimensions |
| Text direction        | ✅                 | ✅                          | Preserves and applies `"ltr"` / `"rtl"` with `preserveDirection`  |
| Horizontal rules      | ✅                 | ✅                          | `_type: "horizontal-rule"` (`hr`, `horizontalrule`, `break`)      |
| Custom block styles   | ✅                 | ✅ rules / `blockStyle`     | Custom styles like `"subtitle"`, `"lead"`, `"callout"`            |
| Hard breaks           | ✅                 | ✅                          | Newlines inside spans or `linebreak` nodes                         |

## How Custom Blocks & Nodes are Translated

Rich text editors differ fundamentally in how they represent content beyond standard text. This bridge provides four translation mechanisms covering the complete Portable Text specification:

### 1. Custom Top-Level Object Blocks (Callouts, Embeds, Hero)

In Portable Text, custom non-text blocks are objects with a `_type` string (e.g. `{ _type: "callout", tone: "warning" }`).

- **Lexical → Portable Text (Save)**:
  Register a rule in `options.rules`. The rule inspects the serialized Lexical node and returns a Portable Text object block (or an array of blocks).
  ```ts
  const options = {
    rules: [
      {
        type: "callout",
        toPortableText: (node, ctx) => ({
          _type: "callout",
          _key: ctx.key(),
          tone: node.tone ?? "info",
          // Recursively convert child Lexical blocks inside this container:
          content: ctx.convertBlocks(node.children ?? []),
        }),
      },
    ],
  };
  ```

- **Portable Text → Lexical (Load)**:
  Register a rule in `options.rules` or provide an `object` factory in `options.factories`.
  ```ts
  portableTextToLexical(editor, blocks, {
    factories,
    rules: [
      {
        type: "callout",
        toLexical: (block, ctx) => {
          const node = $createCalloutNode(block.tone);
          // Recursively convert nested Portable Text blocks into Lexical nodes:
          if (Array.isArray(block.content)) {
            for (const childNode of ctx.convertBlocks(block.content)) {
              node.append(childNode);
            }
          }
          return node;
        },
      },
    ],
  });
  ```

### 2. Custom Inline Objects (Mentions, Badges, Inline Math)

In Portable Text, inline objects reside directly inside `block.children` alongside text spans (`child._type !== "span"`).

- **Lexical → Portable Text (Save)**:
  Inline rules match any Lexical node `type` inside paragraph text. The converter automatically allocates a `_key` if omitted:
  ```ts
  {
    type: "mention",
    toPortableText: (node) => ({
      _type: "mention",
      userId: node.userId,
      label: node.label,
    }),
  }
  ```

- **Portable Text → Lexical (Load)**:
  The converter checks `rules` matching `child._type`, falling back to `factories.object(child)`:
  ```ts
  {
    type: "mention",
    toLexical: (block) => $createMentionNode(block.userId, block.label),
  }
  ```

### 3. Custom Mark Definitions / Annotations (Internal Links, Comments, Footnotes)

In Portable Text, annotations wrap text spans by referencing an entry in `block.markDefs` by key.

- **Lexical → Portable Text (Save)**:
  Standard Lexical `link` and `autolink` nodes are automatically converted to `link` mark definitions with metadata (`href`, `title`, `target`, `rel`). Custom wrappers with children salvage their text spans.
- **Portable Text → Lexical (Load)**:
  Provide `annotationRules` or `factories.annotation`. The converter nests multiple annotations and decorators from innermost to outermost:
  ```ts
  portableTextToLexical(editor, blocks, {
    factories,
    annotationRules: [
      {
        type: "comment",
        toLexical: (def, children, ctx) => {
          return $createCommentNode(def.commentId).append(...children);
        },
      },
    ],
  });
  ```

### 4. Custom Block Styles (Subtitle, Lead, Kicker)

Portable Text blocks can have arbitrary `style` strings (e.g. `style: "lead"`).

- **Lexical → Portable Text (Save)**:
  Heading tags `h1`–`h6` become matching styles; quotes become `"blockquote"`; paragraphs become `"normal"`. Custom block rules can emit blocks with custom `style` properties.
- **Portable Text → Lexical (Load)**:
  Provide a rule matching the style name or implement `factories.blockStyle`:
  ```ts
  factories: {
    ...factories,
    blockStyle: (style, children, block) => {
      if (style === "lead") {
        return $createParagraphNode().append(...children);
      }
      return null; // Fall back to standard paragraph
    },
  }
  ```

---

## Compatibility & Limitations

| Aspect | Behavior & Boundary | Compatibility Note |
| :--- | :--- | :--- |
| **Key Identity** | Portable Text keys (`_key`) are regenerated during conversion. | Keys exist for React array keys and block addressing, not as stable row IDs. Pass a custom `keyGenerator` if your pipeline requires deterministic keys. |
| **Lists: Flat vs. Nested** | Portable Text lists are flat arrays with `level: number`; Lexical lists nest `ListNode` inside `ListItemNode`. | The converter groups consecutive list items by level and type automatically. Skipped levels (e.g. jumping from 1 directly to 3) are normalized into continuous nesting on load. |
| **Checklist Schemas** | Sanity's default Studio schema defines only `bullet` and `number` list items. | Checklists save as `listItem: "bullet"` by default for zero-config Sanity Studio compatibility. Use `checkListMapping: "check"` when your Studio schema supports task lists or when performing lossless round-trips. |
| **Sanity Empty Blocks** | Some Sanity Studio validation rules flag `children: []` on text blocks. | Set `blankSpanOnEmptyBlock: true` to emit `{ _type: "span", text: "", marks: [] }` on empty paragraphs to satisfy strict Studio schema validators. |
| **Node Registration** | The load path builds native Lexical nodes via caller factories. | When converting into a headless or browser editor, make sure all custom node classes (e.g. `TableNode`, `ImageNode`, custom callouts) are registered in the editor's `nodes` array. |
| **Span Merging** | Adjacent text runs with identical formatting merge into a single span. | This matches `@portabletext/markdown` output hygiene. Line breaks directly following links remain separate plain spans so breaks never artificially extend a hyperlink. |
| **Runtime Requirements** | The save path (`lexicalToPortableText`) is pure JSON; the load path (`portableTextToLexical`) uses Lexical's discrete update. | Save path runs anywhere (Cloudflare Workers, edge runtimes, Node.js, tests) without loading Lexical. Load path requires Lexical's discrete update context. |


## Scope

This package converts **Lexical ⇄ Portable Text** only. For markdown use
`@portabletext/markdown` (Portable Text is the hub — convert Lexical → PT →
Markdown, not Lexical → Markdown directly). For rendering use
`@portabletext/react` / `@portabletext/to-html`.

## Behavior notes

- **Keys are not identity.** `_key`s are regenerated on save; they exist for
  React lists and block addressing, not as stable row ids. Pass a
  `keyGenerator` if you need determinism.
- **Span merging.** Adjacent text with identical marks merges into one span.
  A hard break directly after a link starts a new *plain* span — breaks never
  extend a link.
- **Link mark definitions are deduped per block.** Identical link targets and
  metadata share one mark definition; differing attributes get their own.
- **Task lists.** By default, checklists save as `listItem: "bullet"` to
  comply with standard Sanity schemas. Set `checkListMapping: "check"` for
  lossless task list roundtrips including `checked: boolean`.
- **Mark name collisions throw.** Two decorators mapping to the same mark name
  (`{ names: { bold: "em" } }`) is ambiguous, so both `formatToMarks` and
  `marksToFormat` raise instead of silently setting two bits.
- **Missing factories.** `heading`/`quote`/`list`/`code` fall back to
  `paragraph` and call `onMissingFactory`; unknown object blocks are skipped.
- **Unknown nodes on save** follow `onUnknownNode`: salvage children
  (default), skip, or throw.

## Testing

### Setup verification

Before wiring real documents, exercise every extension mechanism with built-in
probe inputs and get one check per mechanism:

```ts
import { verifySetup, formatSetupChecks, allSetupChecksPassed } from "lexical-portable-text";

const checks = verifySetup({
  save: mySaveOptions,                  // your rules, annotationRules, names, flags
  load: { ...myLoadOptions, factories },
  editor,                               // headless or real; required for load checks
});

if (!allSetupChecksPassed(checks)) {
  console.error(formatSetupChecks(checks));
}
```

| Check | What it verifies |
| --- | --- |
| `savePipeline` | Save runs end to end and a paragraph survives |
| `saveRules` | Save `rules` fire for probe nodes with children and produce blocks |
| `saveAnnotationRules` | Save annotation rules emit `markDefs` whose keys are referenced by spans |
| `loadRules` | Load `rules` produce Lexical nodes (run inside `editor.update`) |
| `loadAnnotationRules` | Load annotation rules wrap annotated spans into nodes |
| `markNames` | Every decorator survives the mark-name round trip save ↔ load |
| `roundTripProbe` | A probe block loads, saves back, and preserves its text |

All checks are vacuously true for default setups, so the same call works when
nothing is customized. Load-side checks require an `editor`; a missing editor
is reported as a problem rather than silently skipped.

```bash
pnpm test
```

298 cases across 14 test files:

- **features** (`features.test.ts`) — checklists with checked state,
  autolinks, link metadata, custom mark definitions/annotations, inline objects,
  custom block styles, format & indent preservation, code filename, tables,
  well-known aliases, image blocks, text direction (LTR/RTL), empty block
  compatibility, flexible input shapes, recursive block conversion, and plain
  text extraction (`portableTextToPlainText`).
- **conversion suites** — `lexicalToPortableText` (styles, marks, links,
  breaks, lists, code, tables, unknown nodes, rules, key order) and
  `portableTextToLexical` (styles, marks, links, annotations, breaks, lists,
  code, tables, objects, factory fallbacks, factory arguments, editor isolation).
- **edge suites** — text fidelity (emoji/CJK/RTL, whitespace, 20k-char runs,
  CRLF, markdown-like characters), malformed nodes, partial metadata,
  irregular tables, ordering, rule precedence, mutation checks, list level
  behavior, empty spans, 100-item lists.
- **round-trips** — table-driven documents plus idempotence, checklists, code
  filenames, custom annotations, custom callouts, and tables.
- **property tests** — 300 seeded documents (including custom callouts) must
  round-trip and be idempotent; emitted keys must be unique.
- **fuzz invariants** — 640 generated inputs across both paths must never
  throw under documented policies and must satisfy the Portable Text
  structural contract (resolvable marks, valid styles, unique keys).
- **stress** — 1000-block documents, 500-link blocks, 100-row tables, 500-task
  checklists, 50k-char spans, 30-level lists, 200-deep unknown nesting.
- **units** — mark mapping (all 32 decorator combinations, collisions,
  custom names) and key generation.