// The worker runs the Ant language server in ant.wasm, off the editor's thread. The page sends
// { init: { wasm? } } to start a server and then { lsp: message } for each message to it; the
// worker posts { lsp: message } for each message from it, { log: line } for its log, and
// { error: message } when ant.wasm could not be loaded. Another init starts a new server on the
// same ant.wasm, ending the one before.
import { loadAnt, type Ant, type LanguageServerConnection } from "@ant-lang/wasm";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

let ant: Promise<Ant> | undefined;
let server: Promise<LanguageServerConnection> | undefined;

scope.onmessage = (e) => {
  const data = e.data;
  if (data.init) {
    if (!ant) {
      const loading = loadAnt({ wasm: data.init.wasm });
      ant = loading;
      loading.catch(() => ant === loading && (ant = undefined)); // the next init tries again
    }
    const previous = server;
    previous?.then((s) => s.close(), () => {});
    server = ant!.then((ant) =>
      ant.languageServer((message) => scope.postMessage({ lsp: message }), {
        onLog: (line) => scope.postMessage({ log: line }),
      }),
    );
    server.catch((err) => scope.postMessage({ error: String(err?.message ?? err) }));
    return;
  }
  if (data.lsp) {
    const message = data.lsp;
    server?.then(
      (s) => s.send(message),
      // A server that never started answers each request with why.
      (err) => {
        if (message.id !== undefined && message.method !== undefined) {
          scope.postMessage({ lsp: { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(err?.message ?? err) } } });
        }
      },
    );
  }
};
