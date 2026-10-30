// The parts of the Language Server Protocol the client uses, as the Ant server speaks them.

export interface Message {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
}

export interface MarkupContent {
  kind: "markdown" | "plaintext";
  value: string;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: { location: Location; message: string }[];
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
}

export interface CompletionItem {
  label: string;
  labelDetails?: { detail?: string; description?: string };
  kind?: number;
  detail?: string;
  documentation?: MarkupContent | string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: TextEdit;
  commitCharacters?: string[];
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface Hover {
  contents: MarkupContent | string | { language: string; value: string } | (string | { language: string; value: string })[];
  range?: Range;
}

export interface SignatureHelp {
  signatures: {
    label: string;
    documentation?: MarkupContent | string;
    parameters?: { label: string | [number, number]; documentation?: MarkupContent | string }[];
    activeParameter?: number;
  }[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface DocumentHighlight {
  range: Range;
  kind?: number;
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface FoldingRange {
  startLine: number;
  endLine: number;
  kind?: string;
}

export interface SelectionRange {
  range: Range;
  parent?: SelectionRange;
}

export interface InlayHint {
  position: Position;
  label: string | { value: string }[];
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
}

export interface SemanticTokens {
  resultId?: string;
  data: number[];
}

export interface InitializeResult {
  capabilities: {
    completionProvider?: { triggerCharacters?: string[] };
    signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] };
    semanticTokensProvider?: { legend: { tokenTypes: string[]; tokenModifiers: string[] } };
    [capability: string]: unknown;
  };
}
