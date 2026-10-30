// The worker runs the Ant language server in ant.wasm, off the editor's thread. The page sends
// { init: { wasm? } } once and then { lsp: message } for each message to the server; the worker
// posts { lsp: message } for each message from it, { log: line } for its log, and
// { error: message } when ant.wasm could not be loaded.
import { loadAnt, type LanguageServerConnection } from "@ant-lang/wasm";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

let server: Promise<LanguageServerConnection> | undefined;

scope.onmessage = (e) => {
  const data = e.data;
  if (data.init) {
    server = loadAnt({ wasm: data.init.wasm }).then((ant) =>
      ant.languageServer((message) => scope.postMessage({ lsp: message }), {
        onLog: (line) => scope.postMessage({ log: line }),
      }),
    );
    server.catch((err) => scope.postMessage({ error: String(err?.message ?? err) }));
    return;
  }
  if (data.lsp) {
    server?.then((s) => s.send(data.lsp));
  }
};
