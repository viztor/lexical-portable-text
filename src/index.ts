export {
  lexicalToPortableText,
  type ConverterOptions,
  type LexicalToPortableTextContext,
  type LexicalToPortableTextRule,
} from "./lexicalToPortableText.js";

export {
  portableTextToLexical,
  portableTextToLexicalNodes,
  type HeadingTag,
  type LexicalNodeFactories,
  type PortableTextToLexicalContext,
  type PortableTextToLexicalOptions,
  type PortableTextToLexicalRule,
} from "./portableTextToLexical.js";

export {
  DEFAULT_MARK_NAMES,
  LEXICAL_FORMAT,
  formatToMarks,
  marksToFormat,
  type LexicalDecorator,
  type MarkMappingOptions,
} from "./marks.js";

export { randomKey } from "./keys.js";

export type {
  KeyGenerator,
  LexicalStateInput,
  PortableTextBlock,
  PortableTextContent,
  PortableTextMarkDefinition,
  PortableTextObjectBlock,
  PortableTextSpan,
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedLexicalState,
} from "./types.js";
