// @ant-lang/monaco adds the Ant language to the Monaco editor.
import { startAntLanguageServer, type AntLanguageServer, type AntLanguageServerOptions } from "./client.js";
import { registerAntLanguage, type MonacoApi } from "./language.js";

export { configuration, languageId, registerAntLanguage, tokens, type MonacoApi } from "./language.js";
export { startAntLanguageServer, type AntLanguageServer, type AntLanguageServerOptions } from "./client.js";

/**
 * setupAnt registers the ant language and starts its language server: what most editors need,
 * in one call. Dispose the result to stop the server; the language stays registered.
 */
export function setupAnt(monaco: MonacoApi, options?: AntLanguageServerOptions): AntLanguageServer {
  registerAntLanguage(monaco);
  return startAntLanguageServer(monaco, options);
}
