# lexical-portable-text

[![CI](https://github.com/railmanio/lexical-portable-text/actions/workflows/ci.yml/badge.svg)](https://github.com/railmanio/lexical-portable-text/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lexical-portable-text)](https://www.npmjs.com/package/lexical-portable-text)

Convert [Lexical](https://lexical.dev) editor state to and from
[Portable Text](https://portabletext.org).

- **Save path is pure** — converts serialized state without importing the
  editor runtime, so it runs in workers, servers and tests.
- **Load path uses your nodes** — builds nodes through caller-supplied
  factories, so it never fights Lexical's version-sensitive serialized JSON.
- **Custom blocks first-class** — rules in both directions, with delegation
  (`return null` → default handling) and content-preserving fallbacks.
- **Type-correct** — Portable Text types come from `@portabletext/types`,
  the same package the rest of the ecosystem uses.

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
  code: (language, children) => $createCodeNode(language ?? undefined).append(...children),
  link: (url, children) => $createLinkNode(url).append(...children),
  linebreak: () => $createLineBreakNode(),
};

portableTextToLexical(editor, blocks, { factories });
```

`portableTextToLexical` performs a discrete update (synchronously readable).
Inside an existing `editor.update` context use
`portableTextToLexicalNodes(blocks, { factories })` instead.

### Custom blocks

```ts
const options = {
  // Lexical "callout" node → Portable Text object
  rules: [
    {
      type: "callout",
      toPortableText: (node, ctx) => ({
        _type: "callout",
        _key: ctx.key(),
        tone: node.tone ?? "note",
      }),
    },
  ],
};

portableTextToLexical(editor, blocks, {
  factories: {
    ...factories,
    object: (block) =>
      block._type === "callout"
        ? $createCalloutNode(block.tone) // your node
        : null,
  },
  rules: [
    {
      type: "callout",
      toLexical: (block) => $createCalloutNode(block.tone),
    },
  ],
});
```

Rules may return `null` to delegate to default handling — the same escape
hatch Lexical's own markdown transformers use.

## Options

### `lexicalToPortableText(input, options?)`

| Option                 | Default            | Purpose                                                        |
| ---------------------- | ------------------ | -------------------------------------------------------------- |
| `keyGenerator`         | random 12-char key | Portable Text `_key` generation                                |
| `rules`                | `[]`               | Custom Lexical node rules (`type`, `toPortableText`)           |
| `onUnknownNode`        | `"children"`       | `"children"` salvages content, `"skip"` drops, `"throw"` fails |
| `names` / `onUnmapped` | decorator defaults | Remap or drop decorators (see Marks)                           |

### `portableTextToLexical(editor, blocks, options)`

| Option             | Default            | Purpose                                                |
| ------------------ | ------------------ | ------------------------------------------------------ |
| `factories`        | —                  | `text` + `paragraph` required; other kinds optional    |
| `rules`            | `[]`               | Custom Portable Text `_type` rules (`toLexical`)       |
| `onMissingFactory` | —                  | Notification when a style/kind falls back to paragraph |
| `names`            | decorator defaults | Mark-name remapping (must mirror the save path)        |

## Marks

Lexical packs decorators into a bitmask; Portable Text uses mark names.

| Lexical                             | Bit           | Default mark                 |
| ----------------------------------- | ------------- | ---------------------------- |
| bold                                | 1             | `strong`                     |
| italic                              | 2             | `em`                         |
| strikethrough                       | 4             | `strike-through`             |
| underline                           | 8             | `underline`                  |
| code                                | 16            | `code`                       |
| subscript / superscript / highlight | 32 / 64 / 128 | dropped (opt in via `names`) |

Link nodes become `link` mark definitions (`markDefs`) with the URL; text
spans reference them by key.

## Supported constructs

| Construct             | Save          | Load                        | Notes                                                             |
| --------------------- | ------------- | --------------------------- | ----------------------------------------------------------------- |
| Paragraphs            | ✅            | ✅                          |                                                                   |
| Headings h1–h6        | ✅            | ✅                          | Lexical `heading.tag` ↔ `style`                                   |
| Blockquotes           | ✅            | ✅                          |                                                                   |
| Lists (bullet/number) | ✅            | ✅                          | Flat-list blocks with `level`; nested lists regroup on load       |
| Task lists            | ✅ (`bullet`) | ✅ (`check`)                | Lexical `check` lists save as `bullet` (no PT task list standard) |
| Links                 | ✅            | ✅                          | `markDefs` of `_type: "link"`                                     |
| Hard breaks           | ✅            | ✅                          | Newlines inside spans                                             |
| Code blocks           | ✅            | ✅                          | `_type: "code"` (`language`, `code`)                              |
| Horizontal rules      | ✅            | ✅                          | `_type: "horizontal-rule"`                                        |
| Custom blocks         | ✅ rules      | ✅ rules / `object` factory | Unknown objects are skipped, never mangled                        |
| Images / tables       | —             | —                           | Add rules for your node types                                     |

## Design notes (prior art)

- **Ecosystem naming** — `lexicalToPortableText` / `portableTextToLexical`
  mirrors `markdownToPortableText`, `htmlToPortableText`, etc.
- **Rules + key generator** follow `@portabletext/html`'s
  `rules`/`keyGenerator` options; unhandled structures keep content instead
  of disappearing.
- **Delegation** (`return null`) follows `@lexical/markdown` transformers.
- **Span merging and regenerated keys** follow
  `@portabletext/markdown`'s round-trip contract: keys are not identity.
- **Node factories on load** mirror `$convertFromMarkdownString`, which also
  builds nodes instead of emitting serialized JSON.

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
- **Link mark definitions are deduped per block.** Identical link targets
  share one mark definition; different targets get their own.
- **Mark name collisions throw.** Two decorators mapping to the same mark name
  (`{ names: { bold: "em" } }`) is ambiguous, so both `formatToMarks` and
  `marksToFormat` raise instead of silently setting two bits.
- **Task lists.** Portable Text has no standard task-list item. Lexical
  `check` lists save as `listItem: "bullet"` (checked state dropped), while
  `listItem: "check"` loads into a `check` list with `checked` passed to your
  `listItem` factory. Round-tripping a task list yields a bullet list.
- **Non-link mark definitions** are dropped on load (their text is kept).
  Register a rule if you need custom inline annotations.
- **Missing factories.** `heading`/`quote`/`list`/`code` fall back to
  `paragraph` and call `onMissingFactory`; unknown object blocks are skipped.
- **Unknown nodes on save** follow `onUnknownNode`: salvage children
  (default), skip, or throw.

## Testing

```bash
pnpm test
```

182 cases across ten files:

- **conversion suites** — `lexicalToPortableText` (styles, marks, links,
  breaks, lists, code, unknown nodes, rules, key order) and
  `portableTextToLexical` (styles, marks, links, breaks, lists, code, objects,
  factory fallbacks, factory arguments, editor isolation)
- **edge suites** — text fidelity (emoji/CJK/RTL, whitespace, 20k-char runs,
  CRLF, markdown-like characters), malformed nodes, ordering, rule
  precedence, mutation checks, list level behavior, empty spans, 100-item lists
- **round-trips** — 11 table-driven documents plus idempotence, an empty
  paragraph, a shared mark definition, and a registered custom node
- **property tests** — 300 seeded documents (including custom callouts) must
  round-trip and be idempotent; emitted keys must be unique
- **fuzz invariants** — 640 generated inputs across both paths must never
  throw under documented policies and must satisfy the Portable Text
  structural contract (resolvable marks, valid styles, unique keys)
- **stress** — 1000-block documents, 500-link blocks, 50k-char spans, 30-level
  lists, 200-deep unknown nesting
- **units** — mark mapping (all 32 decorator combinations, collisions,
  custom names) and key generation

`pnpm verify` runs lint + format + typecheck + tests + build, the same gate
CI uses.

## Why this bridge didn't exist before

Investigated 2026-09-12:

- **Portable Text is a serialization spec, not an editor protocol.** It
  defines blocks, spans, marks and objects — not selection, transactions,
  undo or collaboration. Every editor therefore needs its own mapping layer.
- **The ecosystem solved rendering everywhere, not editing.** There are 33
  official `@portabletext/*` packages — React, Vue, Svelte, Solid, Astro,
  React Native (experimental), React PDF, HTML and Markdown renderers — but
  exactly one editor, `@portabletext/editor`, and it is a bespoke XState
  state-machine engine (`xstate`, `@xstate/react`), not Slate, ProseMirror or
  Lexical.
- **The previous editor was Slate-based and is frozen.**
  `@sanity/portable-text-editor` (deps: `slate`, `slate-react`) was last
  published June 2024; the owners rewrote their own editor instead of
  adapting another framework.
- **Official converters point one way — into Portable Text**: HTML→PT,
  Sanity-schema HTML→PT, Contentful RichText→PT, PT↔Markdown. There is no
  PT→ProseMirror, PT→Slate or PT→Lexical.
- **Only one Lexical bridge has ever been published**:
  `@aceccarello/portable-text-to-lexical@0.1.0` (August 2025, one direction,
  Payload-specific, no commits after its release weekend). It sees ~23
  downloads/month; `@portabletext/react` sees ~5M.
- **Why**: the audience is the intersection of "apps using Lexical" and "apps
  that want Portable Text as storage" — a migration-shaped problem whose last
  mile is always app-specific custom nodes. Lexical ships its own
  markdown/HTML converters, and Portable Text shops run Sanity's editor, so
  nobody had a reason to maintain a general bridge.

That is why this package is registry-driven and bidirectional: the general
case only pays off when you already own a Lexical editor and want a portable
document format — exactly the case it was built for.

## Releasing

Publishing runs from the tag in GitHub Actions — no local `npm login` needed.

1. Bump `version` in `package.json`, commit on `main`.
2. Tag and push:

   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

3. `publish.yml` checks the tag matches the package version, runs the full
   `verify` suite, publishes to npm with
   [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC
   provenance, no `NPM_TOKEN`), and creates the GitHub release.

One-time npm setup: under the package's **Publishing access** settings, add a
trusted publisher for repo `railmanio/lexical-portable-text`, workflow
`publish.yml`. For the very first publish (before the package exists on npm),
run `pnpm verify && pnpm publish --access public` locally once, then switch the
package to trusted publishing.

## License

MIT
