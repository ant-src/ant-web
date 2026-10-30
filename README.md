# ant-web

The [Ant](https://github.com/ant-src/ant) language for the web.

- [`@ant-lang/wasm`](packages/wasm): Ant compiled to WebAssembly: format, check and run programs,
  and serve the language server, in browsers and Node.
- [`@ant-lang/monaco`](packages/monaco): Ant support for the Monaco editor, with the language
  server in a web worker.
- [`examples/playground`](examples/playground): an editor with two modules and a Run button.

```sh
npm install
npm run build     # builds ant.wasm from ../ant (or $ANT_DIR) and the Monaco package
npm test
npm run dev       # the playground at http://localhost:5173
npm run fmt       # oxfmt
npm run lint      # oxlint
```
