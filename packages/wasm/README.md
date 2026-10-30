# @ant-lang/wasm

The [Ant](https://github.com/ant-src/ant) language compiled to WebAssembly. Format, type-check and
run Ant programs, and serve the Ant language server, in browsers, web workers and Node.

```sh
npm install @ant-lang/wasm
```

```js
import { loadAnt } from "@ant-lang/wasm";

const ant = await loadAnt();

const files = {
  "main.ant": `import "./greet.ant" { greet }\nprintln(greet(Os.args()[0]))\n`,
  "greet.ant": "export func greet(name: string): string { `hello, ${name}` }\n",
};

ant.check({ files }); // [] — well typed

const decoder = new TextDecoder();
const { exitCode } = await ant.run({
  files,
  path: "main.ant",
  args: ["ada"],
  stdout: (chunk) => console.log(decoder.decode(chunk)),
});

ant.format("func f( ) {  1 }"); // "func f() { 1 }\n"
```

## API

`loadAnt({ wasm? })` instantiates `ant.wasm` and resolves to the API below. By default it loads the
`ant.wasm` next to the package's `index.js` through `new URL("./ant.wasm", import.meta.url)`,
which Vite, webpack and esbuild copy along. Pass `wasm` (a URL, a `Response`, bytes, or a
`WebAssembly.Module`) to load it from elsewhere.

- `format(source, path?)` formats one module as `ant fmt` does, and throws a `SyntaxError` when
  it does not parse.
- `check({ files, path? })` loads and type-checks a program and returns its diagnostics:
  `{ path, line, column, message }`, 1-based, with columns in UTF-16 code units.
- `run({ files, path?, args?, env?, stdin?, stdout?, stderr?, signal? })` runs a program and
  resolves to `{ exitCode, diagnostics }`. Output reaches `stdout` and `stderr` as `Uint8Array`
  chunks. Aborting `signal` interrupts the run as Ctrl-C does, once the program waits on
  something (see [Sandbox](#sandbox)).
- `languageServer(onMessage, { onLog? })` starts the Ant language server and returns
  `{ send, close }`, carrying JSON-RPC messages as objects. Documents are analyzed when their URI
  is a `file:` URI. [@ant-lang/monaco](../monaco) connects it to the Monaco editor.

`files` maps module paths to source text, and `path` is the module to start from: the only module,
or `main.ant` by default. Imports resolve among `files`.

## Sandbox

`ant.wasm` has no file system, processes or environment of its host: a program sees the modules
it is given, the `args`, `env` and `stdin` passed to `run`, and nothing else. `File` and `Cmd`
calls fail. `Http` goes through `fetch`, so in a browser it is subject to CORS.

Run long or untrusted programs in a worker. JavaScript events, an abort among them, reach the
program only while it waits, on a channel, a timer or a fetch: a loop that never waits keeps its
thread busy and never sees the abort, and `worker.terminate()` is the way to stop it.

## Building

`npm run build` compiles `ant.wasm` from a checkout of
[ant-src/ant](https://github.com/ant-src/ant), by default the one next to this repository (set
`ANT_DIR` to choose another), and copies the `wasm_exec.js` of the Go that built it.
