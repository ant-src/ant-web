# @ant-lang/monaco

[Ant](https://github.com/ant-src/ant) language support for the
[Monaco editor](https://microsoft.github.io/monaco-editor/): highlighting, editing defaults, and
the Ant language server, compiled to WebAssembly and running in a web worker.

The language server brings diagnostics, completion, hover, signature help, go to definition,
references, highlights, rename, document symbols, formatting, folding, smart selection, semantic
highlighting, inlay hints and quick fixes.

```sh
npm install @ant-lang/monaco monaco-editor
```

```js
import * as monaco from "monaco-editor";
import { setupAnt } from "@ant-lang/monaco";

setupAnt(monaco);

monaco.editor.create(document.getElementById("editor"), {
  model: monaco.editor.createModel('println("hello")\n', "ant", monaco.Uri.parse("file:///main.ant")),
  "semanticHighlighting.enabled": true,
});
```

Give models `file:` URIs, such as `file:///main.ant`: the server analyzes those, and resolves a
model's imports among the other open models, so `import "./lib.ant"` in `file:///main.ant` finds
the model `file:///lib.ant`.

## API

- `setupAnt(monaco, options?)` does both of the following and returns the server.
- `registerAntLanguage(monaco)` registers the `ant` language, `.ant` files, the editing defaults
  and a Monarch tokenizer, which colors code before the server is ready. It needs no worker.
- `startAntLanguageServer(monaco, options?)` starts the server in a worker and registers its
  providers. The result has `ready`, a promise that settles once the server initialized,
  `request(method, params)` for other requests, and `dispose()`, which stops the server.

Options:

- `worker`: a `Worker`, or a function that makes one, to run the server in. The default is
  `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`. To make your own,
  point it at `@ant-lang/monaco/worker`.
- `wasm`: the URL the worker loads `ant.wasm` from. The default is the one in
  [@ant-lang/wasm](../wasm).
- `onLog`: called with each line the server logs.
- `debounce`: milliseconds to wait after an edit before sending it; 150 by default. A request
  sends the waiting edits of every model first.
- `parameterNameHints`: show parameter names before arguments as inlay hints; false by default.
  Inlay hints for types show either way.

## Bundlers

The worker and `ant.wasm` are found by `new URL(..., import.meta.url)`, which Vite, webpack 5 and
esbuild follow. With Vite, keep the packages out of dependency pre-bundling, which would move the
modules away from the files they point at:

```js
// vite.config.js
export default {
  optimizeDeps: { exclude: ["@ant-lang/monaco", "@ant-lang/wasm"] },
  worker: { format: "es" },
};
```

`ant.wasm` is about 20 MB, 5 MB gzipped; serve it compressed, with `Content-Type:
application/wasm` so it compiles while it downloads.

## Go to definition across models

Monaco's standalone editor peeks at a definition in another model but does not switch to it. To
open it, register an opener that shows the model in your editor:

```js
monaco.editor.registerEditorOpener({
  openCodeEditor(source, uri, selection) {
    const model = monaco.editor.getModel(uri);
    if (!model) return false;
    source.setModel(model);
    if (selection) source.revealRangeInCenter(selection), source.setSelection(selection);
    return true;
  },
});
```

Definitions in the prelude open an `ant:` model of its declarations, whose text the server
supplies.
