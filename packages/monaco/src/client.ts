// The client connects Monaco to the Ant language server (spec/lsp.md) in a worker: it keeps the
// server's documents in step with the ant models, turns published diagnostics into markers, and
// answers Monaco's providers with the server's requests.
import type * as Monaco from "monaco-editor";
import { languageId } from "./language.js";
import type * as lsp from "./protocol.js";

type editor = typeof Monaco.editor;
type IRange = Monaco.IRange;
type ITextModel = Monaco.editor.ITextModel;

export interface AntLanguageServerOptions {
  /**
   * The worker the server runs in, or a function that makes one. The default is this package's
   * worker, made with `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`.
   */
  worker?: Worker | (() => Worker);
  /** Where the worker loads ant.wasm from. The default is the ant.wasm of @ant-lang/wasm. */
  wasm?: string | URL;
  /** Called with each line the server logs and each message it shows. */
  onLog?: (line: string) => void;
  /** How long to wait after an edit before sending it, in milliseconds. The default is 150. */
  debounce?: number;
  /** Shows the names of parameters before arguments as inlay hints. The default is false; type hints show either way. */
  parameterNameHints?: boolean;
}

export interface AntLanguageServer extends Monaco.IDisposable {
  /** Settles when the server has initialized and the providers are registered. */
  readonly ready: Promise<void>;
  /** Sends a request to the server, after any edits waiting to be sent. */
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}

// The URI schemes the server takes documents of: files, and ant: for the prelude it shows.
const schemes = new Set(["file", "ant"]);

const completionKinds = [
  "", "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module",
  "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder",
  "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter",
] as const;

/**
 * startAntLanguageServer starts the Ant language server in a worker and registers Monaco
 * providers for the ant language. Models are served when their URI is a file: URI, such as
 * file:///main.ant; a model's imports resolve among the other open models.
 */
export function startAntLanguageServer(monaco: typeof Monaco, options: AntLanguageServerOptions = {}): AntLanguageServer {
  const ownWorker = typeof options.worker !== "object";
  const worker =
    typeof options.worker === "function"
      ? options.worker()
      : (options.worker ?? new Worker(new URL("./worker.js", import.meta.url), { type: "module" }));
  const delay = options.debounce ?? 150;
  const parameterNameHints = options.parameterNameHints ?? false;
  const log = options.onLog ?? (() => {});

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const disposables: Monaco.IDisposable[] = [];
  const docs = new Map<string, { model: ITextModel; timer?: ReturnType<typeof setTimeout>; listener: Monaco.IDisposable }>();
  const diagnostics = new Map<string, lsp.Diagnostic[]>();
  let disposed = false;

  const post = (message: object) => worker.postMessage({ lsp: { jsonrpc: "2.0", ...message } });
  const notify = (method: string, params: unknown) => post({ method, params });
  const send = <T>(method: string, params: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      post({ id, method, params });
    });

  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (data.log !== undefined) {
      log(data.log);
    } else if (data.error !== undefined) {
      log(`ant.wasm: ${data.error}`);
      for (const p of pending.values()) {
        p.reject(new Error(data.error));
      }
      pending.clear();
    } else if (data.lsp) {
      receive(data.lsp);
    }
  };
  worker.postMessage({ init: { wasm: options.wasm?.toString() } });

  function receive(m: lsp.Message) {
    if (m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id as number);
      pending.delete(m.id as number);
      if (m.error) {
        p?.reject(new Error(m.error.message));
      } else {
        p?.resolve(m.result);
      }
      return;
    }
    switch (m.method) {
      case "textDocument/publishDiagnostics":
        publish(m.params);
        return;
      case "window/logMessage":
      case "window/showMessage":
        log(m.params.message);
        return;
    }
    if (m.id !== undefined) {
      post({ id: m.id, error: { code: -32601, message: `${m.method} is not supported` } });
    }
  }

  // ---- documents

  const served = (model: ITextModel) => model.getLanguageId() === languageId && schemes.has(model.uri.scheme);

  function open(model: ITextModel) {
    const uri = model.uri.toString();
    if (!served(model) || docs.has(uri)) {
      return;
    }
    const doc = {
      model,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      listener: model.onDidChangeContent(() => {
        clearTimeout(doc.timer);
        doc.timer = setTimeout(() => flush(uri), delay);
      }),
    };
    docs.set(uri, doc);
    notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: model.getVersionId(), text: model.getValue() },
    });
  }

  function close(model: ITextModel) {
    const uri = model.uri.toString();
    const doc = docs.get(uri);
    if (!doc) {
      return;
    }
    clearTimeout(doc.timer);
    doc.listener.dispose();
    docs.delete(uri);
    diagnostics.delete(uri);
    monaco.editor.setModelMarkers(model, languageId, []);
    notify("textDocument/didClose", { textDocument: { uri } });
  }

  // flush sends a document's edits now, whole, if any are waiting.
  function flush(uri: string) {
    const doc = docs.get(uri);
    if (!doc || doc.timer === undefined) {
      return;
    }
    clearTimeout(doc.timer);
    doc.timer = undefined;
    notify("textDocument/didChange", {
      textDocument: { uri, version: doc.model.getVersionId() },
      contentChanges: [{ text: doc.model.getValue() }],
    });
  }

  function publish(params: lsp.PublishDiagnosticsParams) {
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri));
    if (!model) {
      return;
    }
    diagnostics.set(model.uri.toString(), params.diagnostics);
    monaco.editor.setModelMarkers(model, languageId, params.diagnostics.map(marker));
  }

  function marker(d: lsp.Diagnostic): Monaco.editor.IMarkerData {
    return {
      ...range(d.range),
      severity: [0, 8, 4, 2, 1][d.severity ?? 1] as Monaco.MarkerSeverity,
      message: d.message,
      source: d.source,
      tags: d.tags as Monaco.MarkerTag[] | undefined,
      relatedInformation: d.relatedInformation?.map((r) => ({
        resource: monaco.Uri.parse(r.location.uri),
        message: r.message,
        ...range(r.location.range),
      })),
    };
  }

  // ---- requests

  const request = <T>(model: ITextModel, method: string, params: object): Promise<T> => {
    const uri = model.uri.toString();
    flush(uri);
    return send<T>(method, { textDocument: { uri }, ...params });
  };

  const at = (p: Monaco.IPosition): lsp.Position => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const span = (r: IRange): lsp.Range => ({
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
  });

  function markdown(c: lsp.MarkupContent | string | undefined): Monaco.IMarkdownString | undefined {
    if (c === undefined) {
      return undefined;
    }
    if (typeof c === "string") {
      return { value: c };
    }
    return { value: c.kind === "markdown" ? c.value : "```\n" + c.value + "\n```" };
  }

  function edits(e: lsp.WorkspaceEdit | null | undefined): Monaco.languages.WorkspaceEdit {
    const out: Monaco.languages.IWorkspaceTextEdit[] = [];
    for (const [uri, list] of Object.entries(e?.changes ?? {})) {
      for (const te of list) {
        out.push({ resource: monaco.Uri.parse(uri), textEdit: { range: range(te.range), text: te.newText }, versionId: undefined });
      }
    }
    return { edits: out };
  }

  // locations converts locations, first making a model for each that has none, such as the
  // prelude, whose text the server gives through ant/source.
  async function locations(result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null): Promise<Monaco.languages.Location[]> {
    const list = result === null ? [] : Array.isArray(result) ? result : [result];
    const out = list.map((l) =>
      "targetUri" in l
        ? { uri: monaco.Uri.parse(l.targetUri), range: range(l.targetSelectionRange) }
        : { uri: monaco.Uri.parse(l.uri), range: range(l.range) },
    );
    await Promise.all(
      out.map(async ({ uri }) => {
        if (monaco.editor.getModel(uri)) {
          return;
        }
        try {
          const text = await send<string>("ant/source", { uri: uri.toString() });
          if (!monaco.editor.getModel(uri)) {
            monaco.editor.createModel(text, languageId, uri);
          }
        } catch {
          // A file the server read from a file system has no source to give; leave it.
        }
      }),
    );
    return out;
  }

  // ---- providers

  function register(init: lsp.InitializeResult) {
    const caps = init.capabilities;
    const L = monaco.languages;
    const sel = languageId;

    disposables.push(
      L.registerCompletionItemProvider(sel, {
        triggerCharacters: caps.completionProvider?.triggerCharacters,
        async provideCompletionItems(model, position) {
          const r = await request<lsp.CompletionList | lsp.CompletionItem[] | null>(model, "textDocument/completion", { position: at(position) });
          const list = Array.isArray(r) ? { isIncomplete: false, items: r } : (r ?? { isIncomplete: false, items: [] });
          const word = model.getWordUntilPosition(position);
          const fallback = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: position.column };
          return {
            incomplete: list.isIncomplete,
            suggestions: list.items.map((item) => ({
              label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
              kind: L.CompletionItemKind[completionKinds[item.kind ?? 1] as keyof typeof L.CompletionItemKind] ?? L.CompletionItemKind.Text,
              detail: item.detail,
              documentation: markdown(item.documentation),
              sortText: item.sortText,
              filterText: item.filterText,
              insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: item.textEdit ? range(item.textEdit.range) : fallback,
              commitCharacters: item.commitCharacters,
            })),
          };
        },
      }),

      L.registerHoverProvider(sel, {
        async provideHover(model, position) {
          const r = await request<lsp.Hover | null>(model, "textDocument/hover", { position: at(position) });
          if (!r) {
            return null;
          }
          const contents = Array.isArray(r.contents) ? r.contents : [r.contents];
          return {
            contents: contents.map((c) => markdown(typeof c === "object" && "language" in c ? "```" + c.language + "\n" + c.value + "\n```" : c)!),
            range: r.range && range(r.range),
          };
        },
      }),

      L.registerSignatureHelpProvider(sel, {
        signatureHelpTriggerCharacters: caps.signatureHelpProvider?.triggerCharacters,
        signatureHelpRetriggerCharacters: caps.signatureHelpProvider?.retriggerCharacters,
        async provideSignatureHelp(model, position) {
          const r = await request<lsp.SignatureHelp | null>(model, "textDocument/signatureHelp", { position: at(position) });
          if (!r || r.signatures.length === 0) {
            return null;
          }
          return {
            value: {
              activeSignature: r.activeSignature ?? 0,
              activeParameter: r.activeParameter ?? 0,
              signatures: r.signatures.map((s) => ({
                label: s.label,
                documentation: markdown(s.documentation),
                parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: markdown(p.documentation) })),
                activeParameter: s.activeParameter,
              })),
            },
            dispose() {},
          };
        },
      }),

      L.registerDefinitionProvider(sel, {
        async provideDefinition(model, position) {
          return locations(await request(model, "textDocument/definition", { position: at(position) }));
        },
      }),

      L.registerReferenceProvider(sel, {
        async provideReferences(model, position, context) {
          return locations(await request(model, "textDocument/references", { position: at(position), context }));
        },
      }),

      L.registerDocumentHighlightProvider(sel, {
        async provideDocumentHighlights(model, position) {
          const r = await request<lsp.DocumentHighlight[] | null>(model, "textDocument/documentHighlight", { position: at(position) });
          return (r ?? []).map((h) => ({ range: range(h.range), kind: ((h.kind ?? 1) - 1) as Monaco.languages.DocumentHighlightKind }));
        },
      }),

      L.registerRenameProvider(sel, {
        async provideRenameEdits(model, position, newName) {
          try {
            return edits(await request<lsp.WorkspaceEdit | null>(model, "textDocument/rename", { position: at(position), newName }));
          } catch (err) {
            return { edits: [], rejectReason: (err as Error).message };
          }
        },
        async resolveRenameLocation(model, position) {
          let r: lsp.Range | { range: lsp.Range; placeholder: string } | { defaultBehavior: boolean } | null;
          try {
            r = await request(model, "textDocument/prepareRename", { position: at(position) });
          } catch (err) {
            return { range: emptyAt(position), text: "", rejectReason: (err as Error).message };
          }
          if (!r || "defaultBehavior" in r) {
            const word = model.getWordAtPosition(position);
            if (!r || !word) {
              return { range: emptyAt(position), text: "", rejectReason: "This element can't be renamed." };
            }
            return { range: { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn }, text: word.word };
          }
          if ("placeholder" in r) {
            return { range: range(r.range), text: r.placeholder };
          }
          const rr = range(r);
          return { range: rr, text: model.getValueInRange(rr) };
        },
      }),

      L.registerDocumentSymbolProvider(sel, {
        displayName: "Ant",
        async provideDocumentSymbols(model) {
          const r = await request<lsp.DocumentSymbol[] | null>(model, "textDocument/documentSymbol", {});
          const convert = (s: lsp.DocumentSymbol): Monaco.languages.DocumentSymbol => ({
            name: s.name,
            detail: s.detail ?? "",
            kind: (s.kind - 1) as Monaco.languages.SymbolKind,
            tags: [],
            range: range(s.range),
            selectionRange: range(s.selectionRange),
            children: s.children?.map(convert),
          });
          return (r ?? []).map(convert);
        },
      }),

      L.registerDocumentFormattingEditProvider(sel, {
        displayName: "ant fmt",
        async provideDocumentFormattingEdits(model, opts) {
          const r = await request<lsp.TextEdit[] | null>(model, "textDocument/formatting", { options: { tabSize: opts.tabSize, insertSpaces: opts.insertSpaces } });
          return (r ?? []).map((e) => ({ range: range(e.range), text: e.newText }));
        },
      }),

      L.registerFoldingRangeProvider(sel, {
        async provideFoldingRanges(model) {
          const r = await request<lsp.FoldingRange[] | null>(model, "textDocument/foldingRange", {});
          return (r ?? []).map((f) => ({
            start: f.startLine + 1,
            end: f.endLine + 1,
            kind: f.kind ? new L.FoldingRangeKind(f.kind) : undefined,
          }));
        },
      }),

      L.registerSelectionRangeProvider(sel, {
        async provideSelectionRanges(model, positions) {
          const r = await request<lsp.SelectionRange[] | null>(model, "textDocument/selectionRange", { positions: positions.map(at) });
          return (r ?? []).map((s) => {
            const out: Monaco.languages.SelectionRange[] = [];
            for (let cur: lsp.SelectionRange | undefined = s; cur; cur = cur.parent) {
              out.push({ range: range(cur.range) });
            }
            return out;
          });
        },
      }),

      L.registerInlayHintsProvider(sel, {
        async provideInlayHints(model, r) {
          const hints = await request<lsp.InlayHint[] | null>(model, "textDocument/inlayHint", { range: span(r) });
          return {
            hints: (hints ?? []).filter((h) => parameterNameHints || h.kind !== 2).map((h) => ({
              label: typeof h.label === "string" ? h.label : h.label.map((p) => p.value).join(""),
              position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
              kind: h.kind as Monaco.languages.InlayHintKind | undefined,
              paddingLeft: h.paddingLeft,
              paddingRight: h.paddingRight,
            })),
            dispose() {},
          };
        },
      }),

      L.registerCodeActionProvider(sel, {
        async provideCodeActions(model, r, context) {
          const known = diagnostics.get(model.uri.toString()) ?? [];
          const related = known.filter((d) =>
            context.markers.some((m) => m.message === d.message && m.startLineNumber === d.range.start.line + 1 && m.startColumn === d.range.start.character + 1),
          );
          const actions = await request<lsp.CodeAction[] | null>(model, "textDocument/codeAction", {
            range: span(r),
            context: { diagnostics: related, only: context.only ? [context.only] : undefined },
          });
          return {
            actions: (actions ?? []).map((a) => ({
              title: a.title,
              kind: a.kind,
              isPreferred: a.isPreferred,
              diagnostics: a.diagnostics?.map(marker),
              edit: a.edit ? edits(a.edit) : undefined,
            })),
            dispose() {},
          };
        },
      }),
    );

    const legend = caps.semanticTokensProvider?.legend;
    if (legend) {
      disposables.push(
        L.registerDocumentSemanticTokensProvider(sel, {
          getLegend: () => legend,
          async provideDocumentSemanticTokens(model) {
            const r = await request<lsp.SemanticTokens | null>(model, "textDocument/semanticTokens/full", {});
            return r && { data: new Uint32Array(r.data), resultId: r.resultId };
          },
          releaseDocumentSemanticTokens() {},
        }),
      );
    }
  }

  function range(r: lsp.Range): IRange {
    return { startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 };
  }

  function emptyAt(p: Monaco.IPosition): IRange {
    return { startLineNumber: p.lineNumber, startColumn: p.column, endLineNumber: p.lineNumber, endColumn: p.column };
  }

  // ---- start

  const ready = send<lsp.InitializeResult>("initialize", {
    processId: null,
    clientInfo: { name: "@ant-lang/monaco" },
    rootUri: null,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        hover: { contentFormat: ["markdown", "plaintext"] },
        completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"], labelDetailsSupport: true } },
        signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
        definition: { linkSupport: false },
        rename: { prepareSupport: true },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        publishDiagnostics: { relatedInformation: true, versionSupport: true, tagSupport: { valueSet: [1, 2] } },
        semanticTokens: { requests: { full: true }, formats: ["relative"], tokenTypes: [], tokenModifiers: [] },
        inlayHint: {},
        codeAction: {},
        foldingRange: {},
        selectionRange: {},
      },
    },
    workspaceFolders: null,
  }).then((init) => {
    if (disposed) {
      return;
    }
    notify("initialized", {});
    register(init);
    for (const model of monaco.editor.getModels()) {
      open(model);
    }
    const editorApi: editor = monaco.editor;
    disposables.push(
      editorApi.onDidCreateModel(open),
      editorApi.onWillDisposeModel(close),
      editorApi.onDidChangeModelLanguage(({ model }) => (served(model) ? open(model) : close(model))),
    );
  });

  return {
    ready,
    request: send,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const d of disposables.splice(0)) {
        d.dispose();
      }
      for (const { model } of [...docs.values()]) {
        close(model);
      }
      for (const p of pending.values()) {
        p.reject(new Error("the Ant language server was stopped"));
      }
      pending.clear();
      if (ownWorker) {
        worker.terminate();
      } else {
        notify("exit", null);
      }
    },
  };
}
