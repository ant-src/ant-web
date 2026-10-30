export interface LoadOptions {
  /**
   * Where ant.wasm comes from: a URL, a fetched Response, its bytes, or a compiled module. The
   * default is the ant.wasm next to this package's index.js, which bundlers that understand
   * `new URL(..., import.meta.url)` copy along.
   */
  wasm?: string | URL | Response | ArrayBuffer | ArrayBufferView | WebAssembly.Module;
}

/** Files are a program's modules: source text by path, such as "main.ant" or "lib/util.ant". */
export type Files = Record<string, string>;

export interface Program {
  files: Files;
  /** The module the program starts from. The default is the only module, or "main.ant". */
  path?: string;
}

/** A diagnostic of loading or checking a program. Lines and columns are 1-based; columns count UTF-16 code units. */
export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  message: string;
}

export interface RunOptions extends Program {
  /** What Os.args returns. */
  args?: string[];
  /** The whole environment, what Os.env and Os.environ see. The default is empty. */
  env?: Record<string, string>;
  /** What the program reads from Os.stdin. */
  stdin?: string;
  /** Called with each write to standard output. Decode with a streaming TextDecoder. */
  stdout?: (chunk: Uint8Array) => void;
  /** Called with each write to standard error, panic reports included. */
  stderr?: (chunk: Uint8Array) => void;
  /**
   * Interrupts the run as Ctrl-C does: Os.interrupt sees the first abort, if asked for it. An
   * abort reaches only a program that waits, as on a channel or a timer, since JavaScript events
   * run only then; to stop one that never waits, run it in a worker and terminate the worker.
   */
  signal?: AbortSignal;
}

export interface RunResult {
  /** The status the ant command would exit with: 0, 1 for a panic or an Err, 2 when the program did not load, 130 when interrupted, or what Os.exit was given. */
  exitCode: number;
  /** Why the program did not load, when exitCode is 2. */
  diagnostics: Diagnostic[];
}

/** A connection to a language server (spec/lsp.md), carrying JSON-RPC messages as objects. */
export interface LanguageServerConnection {
  send(message: object): void;
  /** Ends the server, as the end of its input stream does. */
  close(): void;
}

export interface Ant {
  /** Formats one module, as ant fmt does. Throws a SyntaxError when the source does not parse. */
  format(source: string, path?: string): string;
  /** Loads and type-checks a program, returning its diagnostics; none means it is well typed. */
  check(program: Program): Diagnostic[];
  /** Runs a program. Ant code that blocks, such as on a channel or a timer, does not block the caller. */
  run(options: RunOptions): Promise<RunResult>;
  /**
   * Starts a language server. Documents are analyzed when their URI is a file: URI; their
   * imports resolve among the open documents, since ant.wasm has no file system.
   */
  languageServer(
    onMessage: (message: any) => void,
    options?: { onLog?: (line: string) => void },
  ): LanguageServerConnection;
}

export function loadAnt(options?: LoadOptions): Promise<Ant>;
