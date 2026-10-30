import { loadAnt } from "@ant-lang/wasm";

const ant = loadAnt();

self.onmessage = async ({ data }) => {
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const write = (stream, text) => text && self.postMessage({ stream, text });
  const sink = (name) => (chunk) => write(name, decoders[name].decode(chunk, { stream: true }));
  try {
    const result = await (await ant).run({ ...data, stdout: sink("stdout"), stderr: sink("stderr") });
    for (const d of result.diagnostics) {
      write("stderr", `${d.path}:${d.line}:${d.column}: ${d.message}\n`);
    }
    self.postMessage({ exitCode: result.exitCode });
  } catch (err) {
    write("stderr", `${err?.message ?? err}\n`);
    self.postMessage({ exitCode: 1 });
  } finally {
    // Bytes of a character split at the end of the output come out now.
    write("stdout", decoders.stdout.decode());
    write("stderr", decoders.stderr.decode());
  }
};
