import { loadAnt } from "@ant-lang/wasm";

const ant = loadAnt();

self.onmessage = async ({ data }) => {
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const stream = (name) => (chunk) => self.postMessage({ stream: name, text: decoders[name].decode(chunk, { stream: true }) });
  const result = await (await ant).run({ ...data, stdout: stream("stdout"), stderr: stream("stderr") });
  for (const d of result.diagnostics) {
    self.postMessage({ stream: "stderr", text: `${d.path}:${d.line}:${d.column}: ${d.message}\n` });
  }
  self.postMessage({ exitCode: result.exitCode });
};
