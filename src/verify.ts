/**
 * Setup verification utilities.
 *
 * These helpers exercise every extension mechanism with tiny probe inputs and
 * return a uniform check result, so integrators can confirm their custom
 * block/annotation/inline rules, factories, and mark mappings are wired
 * correctly in one call — before converting real documents.
 *
 * Save-path checks are pure (no Lexical runtime). Load-path checks build
 * nodes through the caller's factories inside `editor.update` when an
 * `editor` is supplied; without one they report a problem instead of
 * silently passing.
 */
import type { ArbitraryTypedObject, PortableTextBlock } from "@portabletext/types";
import type { LexicalEditor } from "lexical";

import { formatToMarks, marksToFormat } from "./marks.js";
import { lexicalToPortableText, type ConverterOptions } from "./lexicalToPortableText.js";
import {
  portableTextToLexical,
  portableTextToLexicalNodes,
  type LexicalNodeFactories,
  type PortableTextToLexicalOptions,
} from "./portableTextToLexical.js";
import type { PortableTextContent, PortableTextSpan, SerializedLexicalNode } from "./types.js";

/** The result of one setup check. */
export interface SetupCheck {
  /** Stable machine identifier, e.g. `"annotationRules"`. */
  name: string;
  /** Whether the mechanism resolved every probe as expected. */
  ok: boolean;
  /** Human-readable failure details; empty when `ok` is true. */
  problems: string[];
}

/** Options accepted by `verifySetup`. */
export interface VerifySetupOptions {
  /**
   * Custom save-side options to probe (rules, annotationRules, mark names,
   * preserve* flags). Omit to skip save-side custom-rule checks.
   */
  save?: ConverterOptions;
  /**
   * Custom load-side options (rules, annotationRules, names, parseAliases)
   * plus the factories object your app wires. Required for load-side checks.
   */
  load?: Omit<PortableTextToLexicalOptions, "factories"> & {
    factories: LexicalNodeFactories;
  };
  /**
   * Editor used to run load-side probes inside a Lexical update. Required
   * whenever `load` is set; without it the load checks report a problem
   * instead of passing silently.
   */
  editor?: LexicalEditor;
}

const probeText = (value: string, format = 0): SerializedLexicalNode => ({
  type: "text",
  version: 1,
  text: value,
  format,
});

const probeSpan = (value: string, marks: string[] = []): PortableTextSpan =>
  ({
    _type: "span",
    _key: `s-${value}`,
    text: value,
    marks,
  }) as PortableTextSpan;

const probeBlock = (children: PortableTextSpan[]): PortableTextContent =>
  ({
    _type: "block",
    _key: "probe-block",
    style: "normal",
    children,
  }) as PortableTextBlock;

function runChecks(name: string, probes: Array<() => string | undefined>): SetupCheck {
  const problems: string[] = [];
  for (const run of probes) {
    const problem = run();
    if (problem !== undefined) problems.push(problem);
  }
  return { name, ok: problems.length === 0, problems };
}

/** Save one node tree through the given options and return the blocks. */
function saveNode(node: SerializedLexicalNode, options: ConverterOptions): PortableTextContent[] {
  return lexicalToPortableText({ root: { type: "root", version: 1, children: [node] } }, options);
}

/** First block of a save result as a text block, if it is one. */
function firstTextBlock(blocks: PortableTextContent[]): PortableTextBlock | undefined {
  const first = blocks[0];
  return first && first._type === "block" ? (first as PortableTextBlock) : undefined;
}

/** The load options to probe, or undefined when load checks are skipped. */
function effectiveLoadOptions(
  options: VerifySetupOptions,
): (PortableTextToLexicalOptions & { editor: LexicalEditor }) | undefined {
  if (!options.load) return undefined;
  if (!options.editor) return undefined;
  return { ...options.load, factories: options.load.factories, editor: options.editor };
}

function runInEditor<T>(editor: LexicalEditor, probe: () => T): T {
  let result!: T;
  editor.update(
    () => {
      result = probe();
    },
    { discrete: true },
  );
  return result;
}

/**
 * Verify that every configured custom-block and custom-annotation mechanism
 * behaves as expected. Checks that need no custom configuration pass
 * vacuously, so the same call works for default and fully-custom setups.
 */
export function verifySetup(options: VerifySetupOptions = {}): SetupCheck[] {
  const checks: SetupCheck[] = [];
  const saveOptions = options.save ?? {};
  const loadOptions = effectiveLoadOptions(options);

  // ── 1. Save pipeline health ──────────────────────────────────────────────
  checks.push(
    runChecks("savePipeline", [
      () => {
        try {
          const block = firstTextBlock(
            saveNode(
              { type: "paragraph", version: 1, children: [probeText("probe")] },
              saveOptions,
            ),
          );
          const span = block?.children[0] as PortableTextSpan | undefined;
          if (span?.text !== "probe") {
            return `expected probe span text "probe", received ${JSON.stringify(span?.text ?? null)}`;
          }
          return undefined;
        } catch (error) {
          return `save pipeline threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 2. Save-side custom rules ("rules") ─────────────────────────────────
  checks.push(
    runChecks("saveRules", [
      () => {
        const firstRule = saveOptions.rules?.[0];
        if (!firstRule) return undefined;
        try {
          const out = saveNode(
            { type: firstRule.type, version: 1, children: [probeText("inner")] },
            saveOptions,
          );
          if (out.length === 0) {
            return `rule for "${firstRule.type}" produced no Portable Text output for a node with children`;
          }
          return undefined;
        } catch (error) {
          return `save rule "${firstRule.type}" threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 3. Save-side annotationRules emit markDefs referenced by spans ──────
  checks.push(
    runChecks("saveAnnotationRules", [
      () => {
        const firstRule = saveOptions.annotationRules?.[0];
        if (!firstRule) return undefined;
        try {
          // Annotation rules apply to inline children, so the probe wraps the
          // annotation node in a paragraph like a real document would.
          const block = firstTextBlock(
            saveNode(
              {
                type: "paragraph",
                version: 1,
                children: [
                  {
                    type: firstRule.type,
                    version: 1,
                    _key: "probe-annot",
                    children: [probeText("annot")],
                  },
                ],
              },
              saveOptions,
            ),
          );
          if (!block) {
            return `annotation rule "${firstRule.type}" produced no text block (a generic rule may have captured the node first)`;
          }
          const defs = block.markDefs ?? [];
          if (defs.length === 0) {
            return `annotation rule "${firstRule.type}" produced no markDefs`;
          }
          const referenced = new Set(
            (block.children as PortableTextSpan[]).flatMap((child) => child.marks ?? []),
          );
          if (!defs.some((def) => referenced.has(String(def._key)))) {
            return `markDef keys [${defs.map((def) => String(def._key)).join(", ")}] are not referenced by any child span`;
          }
          return undefined;
        } catch (error) {
          return `annotation rule "${firstRule.type}" threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 4. Load-side custom rules build nodes ───────────────────────────────
  checks.push(
    runChecks("loadRules", [
      () => {
        const firstRule = options.load?.rules?.[0];
        if (!firstRule) return undefined;
        if (!loadOptions) {
          return `load-side verification for rule "${firstRule.type}" requires both "load" (with factories) and an "editor"`;
        }
        try {
          const nodes = runInEditor(loadOptions.editor, () =>
            portableTextToLexicalNodes(
              [{ _type: firstRule.type, _key: "probe" } as ArbitraryTypedObject],
              loadOptions,
            ),
          );
          if (nodes.length === 0) {
            return `load rule "${firstRule.type}" produced no Lexical nodes`;
          }
          return undefined;
        } catch (error) {
          return `load rule "${firstRule.type}" threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 5. Load-side annotationRules wrap children ──────────────────────────
  checks.push(
    runChecks("loadAnnotationRules", [
      () => {
        const firstRule = options.load?.annotationRules?.[0];
        if (!firstRule) return undefined;
        if (!loadOptions) {
          return `load-side verification for annotation rule "${firstRule.type}" requires both "load" (with factories) and an "editor"`;
        }
        try {
          const nodes = runInEditor(loadOptions.editor, () =>
            portableTextToLexicalNodes(
              [
                {
                  ...probeBlock([probeSpan("annotated", ["probe-def"])]),
                  markDefs: [{ _type: firstRule.type, _key: "probe-def" }],
                },
              ],
              loadOptions,
            ),
          );
          if (nodes.length === 0) {
            return `annotation rule "${firstRule.type}" produced no Lexical nodes`;
          }
          return undefined;
        } catch (error) {
          return `load annotation rule "${firstRule.type}" threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 6. Mark name symmetry (save ↔ load) ─────────────────────────────────
  checks.push(
    runChecks("markNames", [
      () => {
        try {
          const bits = [
            ["bold", 1],
            ["italic", 2],
            ["strikethrough", 4],
            ["underline", 8],
            ["code", 16],
          ] as const;
          for (const [decorator, bit] of bits) {
            const configured = saveOptions.names?.[decorator];
            if (configured === null) continue; // explicitly dropped: fine
            const marks = formatToMarks(bit, saveOptions);
            if (configured === undefined && marks.length === 0) {
              return `decorator "${decorator}" produced no marks with default names`;
            }
            const loadNames = loadOptions ?? saveOptions;
            const roundTrip = marksToFormat(marks, loadNames);
            if ((roundTrip & bit) !== bit) {
              return `decorator "${decorator}" (${bit}) does not survive the mark-name round trip (marks: ${JSON.stringify(marks)})`;
            }
          }
          return undefined;
        } catch (error) {
          return `mark name check threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  // ── 7. Round-trip probe document ────────────────────────────────────────
  checks.push(
    runChecks("roundTripProbe", [
      () => {
        if (!loadOptions) return undefined;
        try {
          const source = probeBlock([probeSpan("plain "), probeSpan("bold", ["strong"])]);
          // portableTextToLexical (not ...Nodes) so the probe editor actually
          // receives the nodes and the re-save can observe them.
          runProbeLoad(loadOptions.editor, [source], loadOptions);
          const saved = lexicalToPortableText(loadOptions.editor, saveOptions);
          if (saved.length === 0) {
            return "re-save of the probe editor produced no blocks";
          }
          const block = firstTextBlock(saved);
          const spans = (block?.children ?? []) as PortableTextSpan[];
          const text = spans.map((span) => span.text).join("");
          if (text !== "plain bold") {
            return `re-save of the probe editor produced unexpected text: ${JSON.stringify(text)}`;
          }
          return undefined;
        } catch (error) {
          return `round-trip probe threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    ]),
  );

  return checks;
}

/** Load probe blocks into the editor root (discrete update). */
function runProbeLoad(
  editor: LexicalEditor,
  blocks: readonly PortableTextContent[],
  options: PortableTextToLexicalOptions,
): void {
  portableTextToLexical(editor, blocks, options);
}

/** Format a verification result for logs or CI annotations. */
export function formatSetupChecks(checks: readonly SetupCheck[]): string {
  return checks
    .map((check) =>
      check.ok
        ? `✔ ${check.name}`
        : `✘ ${check.name}\n  ${check.problems.map((problem) => `- ${problem}`).join("\n  ")}`,
    )
    .join("\n");
}

/** True when every check passed. */
export function allSetupChecksPassed(checks: readonly SetupCheck[]): boolean {
  return checks.every((check) => check.ok);
}
