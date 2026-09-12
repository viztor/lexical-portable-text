/**
 * Test-only custom node + rule definitions, shared by the round-trip and
 * property suites to prove the extension points.
 */
import {
  ElementNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type NodeKey,
  type SerializedElementNode,
} from "lexical";

import type { ConverterOptions, PortableTextToLexicalOptions } from "../src/index.js";
import { factories } from "./helpers.js";

export class CalloutNode extends ElementNode {
  __tone: string;

  constructor(tone = "note", nodeKey?: NodeKey) {
    super(nodeKey);
    this.__tone = tone;
  }

  static getType(): string {
    return "callout";
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__tone, node.__key);
  }

  static importJSON(json: SerializedElementNode & { tone?: string }): CalloutNode {
    return new CalloutNode(json.tone ?? "note");
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  exportJSON(): SerializedElementNode & { tone: string } {
    return { ...super.exportJSON(), tone: this.__tone };
  }

  exportDOM(): DOMExportOutput {
    return { element: null };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    throw new Error("createDOM is not used in headless tests");
  }

  updateDOM(): boolean {
    return false;
  }

  get tone(): string {
    return this.__tone;
  }
}

export const calloutLoad: PortableTextToLexicalOptions = {
  factories: {
    ...factories,
    object: (candidate) =>
      candidate._type === "callout"
        ? new CalloutNode(String((candidate as { tone?: unknown }).tone ?? "note"))
        : null,
  },
  rules: [
    {
      type: "callout",
      toLexical: (candidate) =>
        new CalloutNode(String((candidate as { tone?: unknown }).tone ?? "note")),
    },
  ],
};

export const calloutSave: ConverterOptions = {
  rules: [
    {
      type: "callout",
      toPortableText: (node, context) => ({
        _type: "callout",
        _key: context.key(),
        tone: (node as { tone?: string }).tone ?? "note",
      }),
    },
  ],
};
