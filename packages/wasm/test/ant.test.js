import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadAnt } from "../index.js";

let ant;
before(async () => {
  ant = await loadAnt();
});

function collect() {
  const decoder = new TextDecoder();
  const out = { text: "", write: (chunk) => (out.text += decoder.decode(chunk, { stream: true })) };
  return out;
}

test("format lays out a module", () => {
  assert.equal(ant.format("func f( ) {  1 }"), "func f() { 1 }\n");
});

test("format throws on a syntax error", () => {
  assert.throws(() => ant.format("func ("), SyntaxError);
});

test("check reports columns in UTF-16 code units", () => {
  const diags = ant.check({ files: { "main.ant": 'var s = "😀"; var n: int = "x"' } });
  assert.equal(diags.length, 1);
  assert.deepEqual({ ...diags[0], message: undefined }, { path: "main.ant", line: 1, column: 28, message: undefined });
});

test("run imports modules and passes args, env and stdin", async () => {
  const stdout = collect();
  const r = await ant.run({
    files: {
      "main.ant": 'import "./lib.ant" { hi }\nprintln("${hi(Os.args()[0])} ${Os.env("WHO") ?? ""}")\n',
      "lib.ant": 'export func hi(n: string): string { "hi ${n}" }\n',
    },
    path: "main.ant",
    args: ["ada"],
    env: { WHO: "linus" },
    stdout: stdout.write,
  });
  assert.deepEqual(r, { exitCode: 0, diagnostics: [] });
  assert.equal(stdout.text, "hi ada linus\n");
});

test("a string interpolates and a raw string does not", async () => {
  const stdout = collect();
  const r = await ant.run({
    files: { "main.ant": 'var n = 2\nprintln("n=${n}\\t\\${n}")\nprintln(`n=${n}\\t`)\n' },
    stdout: stdout.write,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(stdout.text, "n=2\t${n}\nn=${n}\\t\n");
});

test("run reports a panic on stderr with status 1", async () => {
  const stderr = collect();
  const r = await ant.run({ files: { "main.ant": 'panic("boom")' }, stderr: stderr.write });
  assert.equal(r.exitCode, 1);
  assert.match(stderr.text, /^panic: boom/);
});

test("run returns load diagnostics with status 2", async () => {
  const r = await ant.run({ files: { "main.ant": "func (" } });
  assert.equal(r.exitCode, 2);
  assert.equal(r.diagnostics[0].path, "main.ant");
});

test("an abort interrupts a run", async () => {
  const controller = new AbortController();
  const run = ant.run({
    files: { "main.ant": "while true { Time.sleep(Time.duration(milliseconds: 1)) }" },
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  assert.equal((await run).exitCode, 130);
});

test("a module path may start with a slash", async () => {
  const stdout = collect();
  const r = await ant.run({ files: { "/main.ant": 'println("ok")' }, path: "/main.ant", stdout: stdout.write });
  assert.equal(r.exitCode, 0);
  assert.equal(stdout.text, "ok\n");
  assert.deepEqual(ant.check({ files: { "/main.ant": 'println("ok")' }, path: "/main.ant" }), []);
});

test("time zones come from the embedded database", async () => {
  const stdout = collect();
  const r = await ant.run({
    files: { "main.ant": 'println(Time.zoneId(Result.unwrap(Time.zone("Europe/Stockholm"))))' },
    stdout: stdout.write,
  });
  assert.equal(r.exitCode, 0);
  assert.equal(stdout.text, "Europe/Stockholm\n");
});

test("a callback that throws leaves the instance working", async (t) => {
  t.mock.method(console, "error", () => {});
  const r = await ant.run({
    files: { "main.ant": 'println("a")' },
    stdout: () => {
      throw new Error("callback failed");
    },
  });
  assert.equal(r.exitCode, 0);
  assert.match(String(console.error.mock.calls[0].arguments[0]), /callback failed/);
  assert.equal(ant.format("func f( ) {  1 }"), "func f() { 1 }\n");
});

test("the language server answers and publishes diagnostics", async () => {
  const messages = [];
  let notify;
  const conn = ant.languageServer((m) => {
    messages.push(m);
    notify?.();
  });
  const until = (pred) =>
    new Promise((resolve) => {
      notify = () => {
        const m = messages.find(pred);
        if (m) resolve(m);
      };
      notify();
    });
  conn.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } });
  const init = await until((m) => m.id === 1);
  assert.ok(init.result.capabilities.hoverProvider);
  conn.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const uri = "file:///main.ant";
  conn.send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "ant", version: 1, text: 'var x: int = "s"' } },
  });
  const diags = await until((m) => m.method === "textDocument/publishDiagnostics");
  assert.equal(diags.params.diagnostics[0].message, "cannot use string where int is expected");
  conn.send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: { line: 0, character: 4 } },
  });
  const hover = await until((m) => m.id === 2);
  assert.match(hover.result.contents.value, /var x: int/);
  conn.close();
});
