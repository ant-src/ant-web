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
  /** The rule the diagnostic reports, such as "type-mismatch". */
  code: string;
  /** "error", or "warning" for code that checks but is almost always a mistake. */
  severity: "error" | "warning";
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

export interface TestOptions {
  files: Files;
  /**
   * The test files to run, in order: paths among files whose names end in "_test.ant". The
   * default is every test file among files, in lexical order, as `ant test` finds them.
   */
  paths?: string[];
  /** Runs only the tests whose full name matches, as the -run flag of `ant test`: "parse/0x". */
  run?: string;
  /** Leaves out the tests that match, as the -skip flag. */
  skip?: string;
  /** Starts no test after the first failure. */
  failfast?: boolean;
  /** Called with each event of the run, the last of which is "done". */
  onEvent?: (event: TestEvent) => void;
  /** The whole environment. The default is empty. */
  env?: Record<string, string>;
  /** What the tests read from Os.stdin. */
  stdin?: string;
  /** Called with what the modules write to standard output outside a test, as they initialize. */
  stdout?: (chunk: Uint8Array) => void;
  /** Called with each write to standard error outside a test, the panic of an initializer included. */
  stderr?: (chunk: Uint8Array) => void;
  /** Ends the run, once the tests wait, as RunOptions.signal does. */
  signal?: AbortSignal;
}

/** An event of a test run, as `ant test -json` prints them. `file` is a path of `paths`, `test` a full name such as "parse/0x10", `elapsed` in seconds. */
export type TestEvent =
  | { action: "run"; file: string; test: string }
  /** The text of one write of a test. */
  | { action: "output"; file: string; test: string; output: string }
  | { action: "pass"; file: string; test: string; elapsed: number }
  | { action: "skip"; file: string; test: string; elapsed: number; reason?: string }
  /** `message` holds the failures, as `ant test` reports them; none when only subtests failed. */
  | { action: "fail"; file: string; test: string; elapsed: number; message?: string }
  | { action: "done"; passed: number; failed: number; skipped: number; elapsed: number };

export interface TestResult {
  /** The status `ant test` would exit with: 0, 1 when a test failed or the checker reported an error, 2 when a file did not load, 130 when the signal ended the run, or what Os.exit was given. */
  exitCode: number;
  /** The checker's errors. When there are any, no test ran and there are no events. */
  diagnostics: Diagnostic[];
}

/** A connection to a language server (spec/lsp.md), carrying JSON-RPC messages as objects. */
export interface LanguageServerConnection {
  send(message: object): void;
  /** Ends the server, as the end of its input stream does. */
  close(): void;
}

/** A connection to a debug adapter, carrying Debug Adapter Protocol messages as objects. */
export interface DebugAdapterConnection {
  send(message: object): void;
  /** Ends the session and its program, as the end of the adapter's input stream does. */
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
   * Runs the tests of test files, as `ant test` does: the files are checked first, then each runs
   * as a program of its own. Rejects when a path is not a test file or a pattern does not compile.
   */
  test(options: TestOptions): Promise<TestResult>;
  /**
   * Starts a language server. Documents are analyzed when their URI is a file: URI; their
   * imports resolve among the open documents, since ant.wasm has no file system.
   */
  languageServer(
    onMessage: (message: any) => void,
    options?: { onLog?: (line: string) => void },
  ): LanguageServerConnection;
  /**
   * Starts a debug adapter, what `ant dap` serves, for one session on a program whose modules
   * are files. The launch request's `program` and the sources of breakpoints are paths among
   * files; `env` is the whole environment and `stdin` names one of the files. Requests reach the
   * adapter only while the program waits or is stopped, since JavaScript events run only then:
   * run it in a worker, and terminate the worker to stop a program that never waits.
   */
  debugAdapter(
    program: { files: Files },
    onMessage: (message: any) => void,
    options?: { onLog?: (line: string) => void },
  ): DebugAdapterConnection;
}

export function loadAnt(options?: LoadOptions): Promise<Ant>;
