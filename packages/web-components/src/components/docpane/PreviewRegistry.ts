/**
 * Content-type → preview-kind registry for the live-docs viewer (#1396).
 *
 * The doc pane renders each tab with a preview component chosen by this
 * resolver. v0 ships two real renderers (markdown, code/text) plus a graceful
 * fallback; richer/binary kinds (image, audio, video, pdf, docx) are deferred to
 * a carve-out blocked on an AHP large-resource transport (#1428), so anything we
 * can't render as text resolves to `"fallback"` rather than breaking.
 *
 * @module
 */

/** The preview renderer kind a document tab should use. */
export type PreviewKind = "markdown" | "code" | "fallback";

/** Markdown MIME types and extensions render via react-markdown (trusted, first-party). */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown", "mdx"]);

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
 * Resolve the preview kind for a file from its bridge-reported encoding +
 * content type + URI.
 *
 * - Non-UTF-8 content (the bridge returns `base64` for binary) → `"fallback"`:
 *   v0 cannot render binary as text, and the wire can't stream large media yet
 *   (#1428).
 * - Markdown (by MIME or extension) → `"markdown"`.
 * - Everything else that arrived as text → `"code"` (CodeMirror read-only).
 *
 * @param encoding - The `encoding` field from the resource read (`utf-8` | `base64`).
 * @param contentType - The MIME type from the resource read (may be empty).
 * @param uri - The `file://` URI (used for the extension fallback).
 */
export function resolvePreviewKind(
  encoding: string,
  contentType: string,
  uri: string,
): PreviewKind {
  const normalizedEncoding = encoding.toLowerCase();
  if (
    normalizedEncoding !== "" &&
    normalizedEncoding !== "utf-8" &&
    normalizedEncoding !== "utf8"
  ) {
    return "fallback";
  }
  const ext = extensionOf(uri);
  if (contentType.includes("markdown") || MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  return "code";
}
