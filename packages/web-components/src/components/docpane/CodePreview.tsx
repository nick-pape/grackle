import { useEffect, useRef, type JSX } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtensionForUri } from "./languages.js";
import styles from "./DocPane.module.scss";

/** Props for {@link CodePreview}. */
export interface CodePreviewProps {
  /** The file's text content. */
  content: string;
  /** The file `file://` URI (drives language detection). */
  uri: string;
  /** Whether the app is in a dark theme (selects the CodeMirror highlight). */
  dark: boolean;
}

/**
 * Read-only CodeMirror 6 preview of a text/code file (#1396).
 *
 * A thin manual `EditorView` wrapper (no React binding lib, so no extra React
 * peer surface). The editor is created once per `(uri, dark)`; external content
 * changes (the agent rewrote the file → bridge re-read) are pushed in via
 * `view.dispatch` so the view refreshes without losing the instance. This is
 * also the editable seam for v1 (#1397).
 *
 * Lazy-loaded by {@link DocPane} so CodeMirror stays in its own async chunk.
 */
export function CodePreview({ content, uri, dark }: CodePreviewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest content, read at editor-creation time without forcing a recreate on
  // every content change (refs are stable, so they don't belong in effect deps).
  const contentRef = useRef<string>(content);
  contentRef.current = content;

  // Create (and recreate on language/theme change) the editor.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const language = languageExtensionForUri(uri);
    const extensions: Extension[] = [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(dark ? [oneDark] : []),
      ...(language ? [language] : []),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: contentRef.current, extensions }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [uri, dark]);

  // Reflect external content changes (live refresh) into the existing editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return <div ref={hostRef} className={styles.codeHost} data-testid="doc-code" />;
}
