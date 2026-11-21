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
  assert.deepEqual(
    { ...diags[0], message: undefined },
    {
      path: "main.ant",
      line: 1,
      column: 28,
      message: undefined,
      code: "type-mismatch",
      severity: "error",
    },
  );
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

const stackTest = `import "./stack.ant" { double }

test "double" {
  assert(double(2) == 4)
}

test "sizes" {
  for n in [1, 2] {
    test "of \${n}" {
      println("size \${n}")
      assert(n == 1)
    }
  }
}

test "later" {
  Test.skip("not yet")
}
`;
const stack = "export func double(n: int): int { n * 2 }\n";

test("test runs test files and reports events", async () => {
  const events = [];
  const r = await ant.test({
    files: { "stack_test.ant": stackTest, "stack.ant": stack, ".cache/old_test.ant": "nonsense(" },
    onEvent: (e) => events.push(e),
  });
  assert.deepEqual(r, { exitCode: 1, diagnostics: [] });
  const brief = events.map((e) => (e.action === "done" ? e : `${e.action} ${e.file}: ${e.test}`));
  const done = brief.pop();
  assert.deepEqual(brief, [
    "run stack_test.ant: double",
    "pass stack_test.ant: double",
    "run stack_test.ant: sizes",
    "run stack_test.ant: sizes/of 1",
    "output stack_test.ant: sizes/of 1",
    "pass stack_test.ant: sizes/of 1",
    "run stack_test.ant: sizes/of 2",
    "output stack_test.ant: sizes/of 2",
    "fail stack_test.ant: sizes/of 2",
    "fail stack_test.ant: sizes",
    "run stack_test.ant: later",
    "skip stack_test.ant: later",
  ]);
  assert.deepEqual({ ...done, elapsed: 0 }, { action: "done", passed: 2, failed: 1, skipped: 1, elapsed: 0 });
  const failure = events.find((e) => e.action === "fail");
  assert.match(failure.message, /assertion failed: n == 1[^]*stack_test\.ant:11:13/);
  assert.equal(events.find((e) => e.action === "output").output, "size 1\n");
  assert.equal(events.find((e) => e.action === "skip").reason, "not yet");
});

test("test runs the tests a pattern selects", async () => {
  const events = [];
  const r = await ant.test({
    files: { "stack_test.ant": stackTest, "stack.ant": stack },
    paths: ["stack_test.ant"],
    run: "^sizes$/^of 1$",
    onEvent: (e) => events.push(e),
  });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(
    events.filter((e) => e.action === "pass").map((e) => e.test),
    ["sizes/of 1", "sizes"],
  );
  await assert.rejects(ant.test({ files: { "a_test.ant": "" }, run: "(" }), /run: /);
  await assert.rejects(ant.test({ files: { "a.ant": "" }, paths: ["a.ant"] }), /not a test file/);
});

test("test runs nothing when the checker reports an error", async () => {
  const events = [];
  const r = await ant.test({
    files: { "a_test.ant": 'test "t" {\n  var n: int = "x"\n}\n' },
    onEvent: (e) => events.push(e),
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.diagnostics[0].code, "type-mismatch");
  assert.deepEqual(events, []);
  const missing = await ant.test({ files: { "a_test.ant": 'import "./gone.ant" { f }\n' } });
  assert.equal(missing.exitCode, 2);
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

test("the debug adapter stops at a breakpoint in an imported module and steps", async () => {
  const messages = [];
  let notify;
  const files = {
    "main.ant": 'import "./lib.ant" { double }\nvar n = double(2)\nprintln(n)\n',
    "lib.ant": "export func double(n: int): int {\n  var r = n * 2\n  return r\n}\n",
  };
  const conn = ant.debugAdapter({ files }, (m) => {
    messages.push(m);
    notify?.();
  });
  const until = (pred) =>
    new Promise((resolve) => {
      notify = () => {
        const i = messages.findIndex(pred);
        if (i >= 0) resolve(messages.splice(i, 1)[0]);
      };
      notify();
    });
  let seq = 0;
  const request = async (command, args) => {
    const id = ++seq;
    conn.send({ seq: id, type: "request", command, arguments: args });
    const response = await until((m) => m.type === "response" && m.request_seq === id);
    assert.ok(response.success, response.message);
    return response.body;
  };
  const event = (name) => until((m) => m.type === "event" && m.event === name).then((m) => m.body);
  const locals = async (threadId) => {
    const { stackFrames } = await request("stackTrace", { threadId });
    const { scopes } = await request("scopes", { frameId: stackFrames[0].id });
    const { variables } = await request("variables", { variablesReference: scopes[0].variablesReference });
    return { frame: stackFrames[0], vars: Object.fromEntries(variables.map((v) => [v.name, v.value])) };
  };

  await request("initialize", { adapterID: "ant" });
  await request("launch", { program: "main.ant" });
  await event("initialized");
  const { breakpoints } = await request("setBreakpoints", {
    source: { path: "lib.ant" },
    breakpoints: [{ line: 2 }],
  });
  assert.equal(breakpoints[0].verified, true);
  await request("configurationDone");

  const { threadId, reason } = await event("stopped");
  assert.equal(reason, "breakpoint");
  let at = await locals(threadId);
  assert.deepEqual([at.frame.name, at.frame.source.path, at.frame.line], ["double", "lib.ant", 2]);
  assert.deepEqual(at.vars, { n: "2" });

  await request("next", { threadId });
  assert.equal((await event("stopped")).reason, "step");
  at = await locals(threadId);
  assert.equal(at.frame.line, 3);
  assert.deepEqual(at.vars, { n: "2", r: "4" });

  await request("continue", { threadId });
  assert.equal((await event("exited")).exitCode, 0);
  await event("terminated");
  await request("disconnect");
  conn.close();
});
