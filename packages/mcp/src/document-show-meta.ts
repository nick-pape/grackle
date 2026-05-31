/**
 * Internal `_meta` channel used by the `show_file` tool (#1396 live docs v0) to
 * hand a document-show descriptor to the broker capture in `mcp-server.ts`. The
 * handler runs in-process, so the capture reads the descriptor off the result
 * directly — it never depends on the agent SDK round-tripping `_meta` (the same
 * broker-capture principle the widget tools use, see {@link
 * ./widget-render-meta.js}).
 *
 * Unlike the widget descriptor (which bakes HTML), this carries only a URI
 * **reference**: the document is rendered live by the web `useDocuments` hook
 * reading the file over the AHP resource bridge (#1395), so it stays current for
 * multiple viewers and survives reload.
 */

/** `_meta` key carrying a {@link DocumentShowDescriptor}. */
export const DOCUMENT_SHOW_META_KEY: string = "io.grackle/document-show";

/** Self-contained description of a file the UI should open a read-only live view of. */
export interface DocumentShowDescriptor {
  /** The `file://` resource URI to open (a reference, not baked content). */
  uri: string;
}
