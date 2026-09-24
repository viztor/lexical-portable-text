/**
 * Paired custom-block definitions.
 *
 * A `CustomBlockDefinition` declares BOTH conversion directions for one
 * custom block type, so save and load behavior live side by side and cannot
 * drift apart. `definePipeline()` splits the definitions into the save-side
 * and load-side rule arrays, statically detects asymmetric definitions,
 * merges any additional hand-written options, and exposes a one-call
 * `verify()` built on the probe checks in verify.ts.
 *
 * Note that the two functions are still written by hand (no schema
 * compiler), exactly as in @lexical/markdown - but with this module they are
 * colocated, statically checked for symmetry, and wired into both
 * converters by a single call.
 */
import type { ArbitraryTypedObject, PortableTextMarkDefinition } from "@portabletext/types";
import type { LexicalEditor, LexicalNode } from "lexical";

import type {
  ConverterOptions,
  LexicalToPortableTextAnnotationRule,
  LexicalToPortableTextContext,
  LexicalToPortableTextRule,
} from "./lexicalToPortableText.js";
import type {
  PortableTextToLexicalAnnotationRule,
  PortableTextToLexicalOptions,
  PortableTextToLexicalContext,
  PortableTextToLexicalRule,
} from "./portableTextToLexical.js";
import type { RuleResult } from "./types.js";

import { verifySetup, type SetupCheck } from "./verify.js";

/** Handler signature shared by every save-side half. */
export type CustomBlockSaveHandler<T> = (
  node: import("./types.js").SerializedLexicalNode,
  context: LexicalToPortableTextContext,
) => T | null;

/** Handler for a PT -> Lexical annotation half (wraps already-built children). */
export type CustomAnnotationLoadHandler = (
  def: PortableTextMarkDefinition,
  children: LexicalNode[],
  context: PortableTextToLexicalContext,
) => RuleResult<LexicalNode>;

/** Handler for a PT object block -> Lexical node(s). */
export type CustomBlockLoadHandler = (
  block: ArbitraryTypedObject,
  context: PortableTextToLexicalContext,
) => RuleResult<LexicalNode | LexicalNode[]>;

/**
 * One custom block declared for both directions.
 *
 * - Default (block/inline object): `save` returns the Portable Text object,
 *   `load` receives the same object back.
 * - `annotation: true`: `save` returns the Portable Text mark definition
 *   (children are marked by the converter), `load` receives the mark
 *   definition plus its already-built child nodes and returns the wrapping
 *   Lexical node.
 */
export interface CustomBlockDefinition {
  /**
   * Shared identifier: the Lexical node `type` on the save side and the
   * Portable Text `_type` (or block `style`) on the load side.
   */
  type: string;
  /** Treat this definition as an annotation (mark definition wrapper). */
  annotation?: boolean;
  /**
   * Lexical -> Portable Text half. Block definitions return the PT block(s)
   * or inline object; annotation definitions return the mark definition
   * (omit `_key` to let the converter allocate one).
   */
  save?: CustomBlockSaveHandler<
    | import("./types.js").PortableTextContent
    | import("./types.js").PortableTextContent[]
    | ArbitraryTypedObject
    | ArbitraryTypedObject[]
    | PortableTextMarkDefinition
  >;
  /** Portable Text -> Lexical half (required for load-side support). */
  load?: CustomBlockLoadHandler | CustomAnnotationLoadHandler;
}

/** Reported when a definition is one-sided, i.e. only transpilable one way. */
export interface PipelineIssue {
  type: string;
  direction: "save" | "load";
  message: string;
}

/** The result of bundling custom block definitions into both options. */
export interface CustomBlockPipeline {
  definitions: readonly CustomBlockDefinition[];
  /** Save options ready for `lexicalToPortableText(input, saveOptions)`. */
  saveOptions: ConverterOptions;
  /** Load options requiring the app factory set. */
  loadOptions(
    factories: Parameters<typeof Object>[0] extends never
      ? never
      : NonNullable<PortableTextToLexicalOptions["factories"]>,
  ): PortableTextToLexicalOptions;
  /** Definitions that transpile in only one direction. */
  issues: PipelineIssue[];
  /** One-call probe verification (`editor` needed for the load-side checks). */
  verify(editor: LexicalEditor): SetupCheck[];
}

function isAnnotationDefinition(
  def: CustomBlockDefinition,
): def is CustomBlockDefinition & { annotation: true } {
  return def.annotation === true;
}

export interface DefinePipelineOptions {
  /** Base save options (mark names, preserve* flags, keyGenerator, ...). */
  save?: ConverterOptions;
  /** Base load options without factories (rules here are merged after definitions). */
  load?: Omit<PortableTextToLexicalOptions, "factories">;
  /** Factories used by the load side; also required for `verify()` probes. */
  factories?: NonNullable<PortableTextToLexicalOptions["factories"]>;
}

export interface ConverterPipelineResult {
  /** Save options ready to hand to `lexicalToPortableText`. */
  saveOptions: ConverterOptions;
  /** Complete load options once the factories are attached. */
  loadOptions(factories: PortableTextToLexicalOptions["factories"]): PortableTextToLexicalOptions;
  /** Bundled definitions (as passed in). */
  definitions: readonly CustomBlockDefinition[];
  /** One issue per definition that transpiles in only one direction. */
  issues: PipelineIssue[];
  /** Probe-check the pipeline; `editor` required for load-side checks. */
  verify(editor?: LexicalEditor): SetupCheck[];
}

/**
 * Bundle paired custom definitions into a ready-to-use converter pipeline.
 *
 * Each definition becomes both a save-side and a load-side rule when both
 * halves are present. Definitions with only one half are flagged in
 * `issues` and only wired the direction they support, so the converter
 * never silently skips a way.
 */
export function definePipeline(
  definitions: readonly CustomBlockDefinition[],
  options: DefinePipelineOptions = {},
): ConverterPipelineResult {
  const issues: PipelineIssue[] = [];
  const saveRules: LexicalToPortableTextRule[] = [];
  const saveAnnotationRules: LexicalToPortableTextAnnotationRule[] = [];
  const loadRules: PortableTextToLexicalRule[] = [];
  const loadAnnotationRules: PortableTextToLexicalAnnotationRule[] = [];

  for (const def of definitions) {
    const annotation = isAnnotationDefinition(def);

    if (def.save) {
      const handler = def.save as CustomBlockSaveHandler<
        | import("./types.js").PortableTextContent
        | import("./types.js").PortableTextContent[]
        | ArbitraryTypedObject
        | ArbitraryTypedObject[]
        | PortableTextMarkDefinition
      >;
      if (annotation) {
        saveAnnotationRules.push({
          type: def.type,
          toPortableText: (node, context) =>
            handler(node, context) as PortableTextMarkDefinition | null,
        });
      } else {
        saveRules.push({
          type: def.type,
          toPortableText: (node, context) => handler(node, context) as null,
        });
      }
    } else {
      issues.push({
        type: def.type,
        direction: "save",
        message: `custom block "${def.type}" has no save() half; documents containing it cannot be persisted to Portable Text`,
      });
    }

    if (def.load) {
      if (annotation) {
        loadAnnotationRules.push({
          type: def.type,
          toLexical: (def2, children, context) =>
            (def.load as CustomAnnotationLoadHandler)(def2, children, context),
        });
      } else {
        loadRules.push({
          type: def.type,
          toLexical: (block, context) => (def.load as CustomBlockLoadHandler)(block, context),
        });
      }
    } else {
      issues.push({
        type: def.type,
        direction: "load",
        message: `custom block "${def.type}" has no load() half; ${
          annotation
            ? "mark definitions of this type are dropped on load (text survives)"
            : "Portable Text objects of this type are skipped on load"
        }`,
      });
    }
  }

  const baseSave = options.save ?? {};
  const baseLoad = options.load ?? {};

  const saveOptions: ConverterOptions = {
    ...baseSave,
    rules: [...(baseSave.rules ?? []), ...saveRules],
    annotationRules: [...(baseSave.annotationRules ?? []), ...saveAnnotationRules],
  };

  const verify = (editor?: LexicalEditor): SetupCheck[] => {
    if (!options.factories) return verifySetup({ save: saveOptions, editor });
    return verifySetup({
      save: saveOptions,
      load: {
        factories: options.factories,
        ...(baseLoad as Omit<PortableTextToLexicalOptions, "factories">),
      },
      editor,
    });
  };

  return {
    definitions,
    saveOptions,
    loadOptions: (factories) => ({
      ...baseLoad,
      factories,
      rules: [...(baseLoad.rules ?? []), ...loadRules],
      annotationRules: [...(baseLoad.annotationRules ?? []), ...loadAnnotationRules],
    }),
    issues,
    verify,
  };
}
