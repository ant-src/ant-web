import type * as Monaco from "monaco-editor";

export const languageId = "ant";

// configuration carries the editing defaults of vscode-ant's language-configuration.json.
export const configuration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
    { open: "`", close: "`", notIn: ["string", "comment"] },
    { open: "/*", close: " */", notIn: ["string"] },
  ],
  autoCloseBefore: ";:.,=}])>` \n\t",
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "`", close: "`" },
    { open: "<", close: ">" },
  ],
  folding: {
    markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ },
  },
  indentationRules: {
    increaseIndentPattern: /^.*(\{[^}"'`]*|\([^)"'`]*|\[[^\]"'`]*|<[A-Za-z][\w-]*(\s[^>]*)?(?<!\/)>)\s*(\/\/.*)?$/,
    decreaseIndentPattern: /^\s*([}\])]|<\/[A-Za-z][\w-]*>|<\/>)/,
  },
  onEnterRules: [
    {
      beforeText: /^\s*\/\/[!/]?.*$/,
      afterText: /^(?!\s*$).+/,
      action: { indentAction: 0 /* None */, appendText: "// " },
    },
    {
      beforeText: /^\s*\/\*\*?(?!\/)([^*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: { indentAction: 2 /* IndentOutdent */, appendText: " * " },
    },
  ],
  wordPattern: /[A-Za-z_][A-Za-z0-9_]*/,
};

// tokens is a Monarch tokenizer after vscode-ant's TextMate grammar. It colors a model before
// the language server is ready, and the server's semantic tokens refine names afterwards.
export const tokens: Monaco.languages.IMonarchLanguage & Record<string, unknown> = {
  defaultToken: "",
  tokenPostfix: ".ant",

  keywords: [
    "if",
    "else",
    "for",
    "while",
    "select",
    "return",
    "break",
    "continue",
    "go",
    "defer",
    "try",
    "in",
    "is",
    "var",
    "func",
    "type",
    "import",
    "export",
  ],
  reserved: [
    "as",
    "async",
    "await",
    "catch",
    "class",
    "const",
    "enum",
    "finally",
    "function",
    "interface",
    "let",
    "match",
    "switch",
    "this",
    "throw",
    "undefined",
  ],
  constants: ["true", "false", "null", "void"],
  primitives: [
    "int",
    "int8",
    "int16",
    "int32",
    "int64",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "byte",
    "float32",
    "float64",
    "string",
    "bool",
    "never",
  ],
  builtins: ["print", "println", "eprint", "eprintln", "panic", "len"],

  escapes: /\\(?:[ntr\\"`$]|u\{[0-9A-Fa-f]+\})/,

  tokenizer: {
    root: [
      [/^#!.*$/, "comment"],
      { include: "@whitespace" },
      [/"/, "string", "@string"],
      [/`/, "string", "@template"],
      // A regex literal is told from division by what follows it, as Monaco's JavaScript does.
      [/\/(?=([^\\/\n]|\\.)+\/[a-z]*\s*([.;,)\]}]|$))/, "regexp", "@regexp"],
      [/<>/, "delimiter.html", "@markupContent"],
      [/(<)(script|style)\b/, ["delimiter.html", { token: "tag", next: "@rawTag.$2" }]],
      [/(<)([A-Za-z][\w-]*)(?=[\s/>])/, ["delimiter.html", { token: "tag", next: "@markupTag" }]],
      // A keyword followed by a colon is a field name, as in { type: 1 }.
      [/[A-Za-z_]\w*(?=\s*:(?!=))/, "identifier"],
      [
        /[a-z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@reserved": "invalid",
            "@constants": "constant",
            "@primitives": "type",
            "@builtins": "predefined",
            "@default": "identifier",
          },
        },
      ],
      [/[A-Z]\w*/, "type.identifier"],
      [/0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*/, "number.hex"],
      [/0b[01](?:_?[01])*/, "number"],
      [/\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:e[+-]?\d(?:_?\d)*)?/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/\.\.\.|\?\.|==|!=|<=|>=|&&|\|\||\?\?|[+\-*/%]=|[=+\-*/%<>!|?]/, "operator"],
      [/[.,;:]/, "delimiter"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*/, "comment", "@comment"],
      [/\/\/!.*$/, "comment.doc"],
      [/\/\/.*$/, "comment"],
    ],

    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],

    string: [
      [/[^\\"]+$/, "string", "@pop"], // a string ends at the end of its line
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\.$/, "string.escape.invalid", "@pop"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],

    template: [
      [/\$\{/, "delimiter.bracket", "@interpolation"],
      [/[^\\`$]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/\$/, "string"],
      [/`/, "string", "@pop"],
    ],

    interpolation: [
      [/\{/, "delimiter.bracket", "@interpolation"],
      [/\}/, "delimiter.bracket", "@pop"],
      { include: "root" },
    ],

    regexp: [
      [/\[/, "regexp.escape.control", "@regexpClass"],
      [/\\./, "regexp.escape"],
      [/(\/)([a-z]*)/, ["regexp", { token: "keyword.other", next: "@pop" }]],
      [/[^\\/[]+/, "regexp"],
    ],

    regexpClass: [
      [/\\./, "regexp.escape"],
      [/\]/, "regexp.escape.control", "@pop"],
      [/[^\\\]]+/, "regexp"],
    ],

    markupTag: [
      [/\/>/, "delimiter.html", "@pop"],
      [/>/, { token: "delimiter.html", switchTo: "@markupContent" }],
      { include: "@markupAttributes" },
    ],

    rawTag: [
      [/\/>/, "delimiter.html", "@pop"],
      [/>/, { token: "delimiter.html", switchTo: "@rawContent.$S2" }],
      { include: "@markupAttributes" },
    ],

    markupAttributes: [
      [/[ \t\r\n]+/, ""],
      [/\{/, "delimiter.bracket", "@interpolation"],
      [/[A-Za-z_][\w:.-]*/, "attribute.name"],
      [/=/, "delimiter"],
      [/"[^"]*"/, "attribute.value"],
    ],

    markupContent: [
      [/<\/[A-Za-z][\w-]*\s*>|<\/>/, "tag", "@pop"],
      [/<>/, "delimiter.html", "@markupContent"],
      [/(<)(script|style)\b/, ["delimiter.html", { token: "tag", next: "@rawTag.$2" }]],
      [/(<)([A-Za-z][\w-]*)/, ["delimiter.html", { token: "tag", next: "@markupTag" }]],
      [/\{/, "delimiter.bracket", "@interpolation"],
      [/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9A-Fa-f]+);/, "string.escape"],
      [/[^<{&]+/, ""],
      [/&/, ""],
    ],

    rawContent: [
      [/<\/(\w+)\s*>/, { cases: { "$1==$S2": { token: "tag", next: "@pop" }, "@default": "" } }],
      [/[^<]+/, ""],
      [/</, ""],
    ],
  },
};

let registered = false;

/** registerAntLanguage registers the ant language, its editing defaults, and its tokenizer. Calling it again does nothing. */
export function registerAntLanguage(monaco: typeof Monaco): void {
  if (registered) {
    return;
  }
  registered = true;
  monaco.languages.register({ id: languageId, extensions: [".ant"], aliases: ["Ant", "ant"] });
  monaco.languages.setLanguageConfiguration(languageId, configuration);
  monaco.languages.setMonarchTokensProvider(languageId, tokens);
}
