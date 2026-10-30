// @ant-lang/wasm loads Ant compiled to WebAssembly and wraps what it exposes: format, check,
// run, and the language server.
import "./wasm_exec.js";

let instances = 0;

/**
 * loadAnt instantiates ant.wasm and resolves to its API. Each call starts an instance of its
 * own; one instance serves any number of calls.
 *
 * @param {import("./index.d.ts").LoadOptions} [options]
 * @returns {Promise<import("./index.d.ts").Ant>}
 */
export async function loadAnt(options = {}) {
  const source = options.wasm ?? new URL("./ant.wasm", import.meta.url);
  const go = new globalThis.Go();
  const ready = `__antReady${++instances}_${Math.random().toString(36).slice(2)}`;
  const api = new Promise((resolve) => {
    globalThis[ready] = (api) => {
      delete globalThis[ready];
      resolve(api);
    };
  });
  go.argv = ["ant", ready];
  const instance = await instantiate(source, go.importObject);
  const exited = go.run(instance);
  return wrap(
    await Promise.race([api, exited.then(() => Promise.reject(new Error("ant.wasm exited before it was ready")))]),
  );
}

async function instantiate(source, imports) {
  if (source instanceof WebAssembly.Module) {
    return WebAssembly.instantiate(source, imports);
  }
  if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
    return (await WebAssembly.instantiate(source, imports)).instance;
  }
  if (typeof Response !== "undefined" && source instanceof Response) {
    return (await WebAssembly.instantiateStreaming(source, imports)).instance;
  }
  const url = new URL(String(source), globalThis.location?.href);
  if (url.protocol === "file:") {
    // Node reads files, which fetch does not; the name is a variable so bundlers leave it be.
    const fs = "node:fs/promises";
    const { readFile } = await import(/* @vite-ignore */ /* webpackIgnore: true */ fs);
    return (await WebAssembly.instantiate(await readFile(url), imports)).instance;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetching ${url}: ${response.status} ${response.statusText}`);
  }
  if (response.headers.get("Content-Type")?.startsWith("application/wasm")) {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance;
  }
  return (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance;
}

// rootOf is the module a program starts from: the path given, or the one module there is.
function rootOf(files, path) {
  if (path) {
    return path;
  }
  const paths = Object.keys(files);
  return paths.length === 1 ? paths[0] : "main.ant";
}

function wrap(raw) {
  return {
    format(source, path = "main.ant") {
      const r = raw.format(path, source);
      if (r.error !== undefined) {
        throw new SyntaxError(r.error);
      }
      return r.text ?? "";
    },
    check({ files, path }) {
      return raw.check(rootOf(files, path), files);
    },
    run(options) {
      return raw.run({ ...options, path: rootOf(options.files, options.path) });
    },
    languageServer(onMessage, options = {}) {
      const conn = raw.languageServer((json) => onMessage(JSON.parse(json)), options.onLog);
      return {
        send: (message) => conn.send(JSON.stringify(message)),
        close: () => conn.close(),
      };
    },
  };
}
