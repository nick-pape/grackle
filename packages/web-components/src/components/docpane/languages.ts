/**
 * Maps a file URI's extension to a CodeMirror 6 language extension for the
 * read-only code preview (#1396). First-class language packs cover the
 * languages most common in this repo; `@codemirror/legacy-modes` (one package,
 * many `StreamLanguage` grammars) covers the long tail. Unknown extensions get
 * no language (plain text with line numbers + neutral highlighting).
 *
 * @module
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/legacy-modes/mode/python";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { c, cpp, java, csharp, kotlin } from "@codemirror/legacy-modes/mode/clike";

/** Extract the lowercased file extension (without the dot) from a URI or path. */
function extensionOf(uri: string): string {
  let path: string = uri;
  try {
    path = new URL(uri).pathname;
  } catch {
    // Not a URL — use the raw string.
  }
  const lastSlash = path.lastIndexOf("/");
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Resolve the CodeMirror language extension for a file URI, or `undefined` when
 * no grammar is known (the editor still renders the text, just unhighlighted).
 */
export function languageExtensionForUri(uri: string): Extension | undefined {
  const ext = extensionOf(uri);
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "py":
      return StreamLanguage.define(python);
    case "go":
      return StreamLanguage.define(go);
    case "rs":
      return StreamLanguage.define(rust);
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "yaml":
    case "yml":
      return StreamLanguage.define(yaml);
    case "toml":
      return StreamLanguage.define(toml);
    case "c":
    case "h":
      return StreamLanguage.define(c);
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
      return StreamLanguage.define(cpp);
    case "java":
      return StreamLanguage.define(java);
    case "cs":
      return StreamLanguage.define(csharp);
    case "kt":
    case "kts":
      return StreamLanguage.define(kotlin);
    default:
      return undefined;
  }
}
