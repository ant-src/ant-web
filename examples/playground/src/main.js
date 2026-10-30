import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { setupAnt } from "@ant-lang/monaco";
import RunWorker from "./run.worker.js?worker";

// Vite bundles the editor worker itself; the default new URL(...) one fails in a production build.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const server = setupAnt(monaco, { onLog: (line) => console.debug("ant lsp:", line) });
const status = document.querySelector("#status");
server.ready.then(
  () => (status.textContent = "ready"),
  (err) => (status.textContent = `language server failed: ${err.message}`),
);

const files = {
  "main.ant": `import "./shapes.ant" { area, Circle, Rect, Shape }

// Hover a name, press F12 on area, or break a type.
var shapes: Array[Shape] = [
  Circle{ radius: 1.5 },
  Rect{ width: 2.0, height: 3.0 },
]

for s in shapes {
  println(\`\${s} has area \${Math.round(area(s) * 100.0) / 100.0}\`)
}
`,
  "shapes.ant": `export type Circle = { radius: float64 }
export type Rect = { width: float64, height: float64 }
export type Shape = Circle | Rect

// area is the area of a shape.
export func area(s: Shape): float64 {
  if s is Circle { Math.PI * s.radius * s.radius } else { s.width * s.height }
}
`,
};

const models = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path, monaco.editor.createModel(text, "ant", monaco.Uri.parse(`file:///${path}`))]),
);

const dark = matchMedia("(prefers-color-scheme: dark)");
const editor = monaco.editor.create(document.querySelector("#editor"), {
  model: models["main.ant"],
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  tabSize: 2,
  "semanticHighlighting.enabled": true,
  inlayHints: { enabled: "on" },
  theme: dark.matches ? "vs-dark" : "vs",
});
dark.addEventListener("change", (e) => monaco.editor.setTheme(e.matches ? "vs-dark" : "vs"));

// Definitions in another model open it in the editor, as tabs would.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, uri, selection) {
    const model = monaco.editor.getModel(uri);
    if (!model) return false;
    show(model);
    if (selection) {
      editor.setSelection(selection);
      editor.revealRangeInCenter(selection);
    }
    return true;
  },
});

const tabs = document.querySelector("#tabs");
function show(model) {
  editor.setModel(model);
  for (const b of tabs.children) b.classList.toggle("active", b.dataset.uri === model.uri.toString());
}
function renderTabs() {
  tabs.replaceChildren(
    ...monaco.editor.getModels().filter((m) => m.getLanguageId() === "ant").map((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = m.uri.path.split("/").pop();
      b.dataset.uri = m.uri.toString();
      b.onclick = () => show(m);
      return b;
    }),
  );
  show(editor.getModel());
}
monaco.editor.onDidCreateModel(renderTabs);
renderTabs();

document.querySelector("#format").onclick = () => editor.getAction("editor.action.formatDocument").run();

// Programs run in a worker of their own, so a long run leaves the language server free.
const output = document.querySelector("#output");
let runner;
document.querySelector("#run").onclick = () => {
  runner?.terminate();
  runner = new RunWorker();
  output.replaceChildren();
  const sources = Object.fromEntries(Object.entries(models).map(([path, m]) => [path, m.getValue()]));
  runner.onmessage = ({ data }) => {
    if (data.exitCode !== undefined) {
      append(`\n[exit status ${data.exitCode}]\n`, "err");
      runner.terminate();
      return;
    }
    append(data.text, data.stream === "stderr" ? "err" : "");
  };
  runner.postMessage({ files: sources, path: "main.ant" });
};

function append(text, cls) {
  const span = document.createElement("span");
  span.textContent = text;
  if (cls) span.className = cls;
  output.append(span);
}
