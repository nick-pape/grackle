/**
 * Filesystem core for the AHP `resources` read capability.
 *
 * Pure, transport-agnostic helpers that back the `resourceRead` /
 * `resourceList` / `createResourceWatch` handlers in {@link ./ahp-handlers.ts}.
 * Keeping the filesystem + sandbox logic here (with no AHP socket / connection
 * dependencies) makes it unit-testable without standing up a wire.
 *
 * All paths are sandboxed to a caller-supplied set of allowed roots (a
 * connection's session working trees). The sandbox generalises the
 * symlink-aware containment check in {@link ./token-writer.ts}: a request path
 * must resolve — after realpath'ing the nearest existing ancestor *and*, when it
 * exists, the target itself — under at least one allowed root. This rejects both
 * `../` traversal and symlinks inside a root that point outside it.
 *
 * @module resource-fs
 */

import {
  readFile as readFileNode,
  readdir as readdirNode,
  realpath as realpathNode,
  stat as statNode,
} from "node:fs/promises";
import { existsSync as existsSyncNode } from "node:fs";
import { Buffer } from "node:buffer";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AhpErrorCodes, ContentEncoding, JsonRpcErrorCodes } from "@grackle-ai/ahp";
import type { DirectoryEntry, ResourceListResult, ResourceReadResult } from "@grackle-ai/ahp";

/**
 * A failure that maps onto a JSON-RPC error. `code` is an
 * {@link AhpErrorCodes} or {@link JsonRpcErrorCodes} numeric value; the handler
 * layer translates this into a wire error response.
 */
export class ResourceError extends Error {
  /** Numeric JSON-RPC / AHP error code. */
  public readonly code: number;

  public constructor(code: number, message: string) {
    super(message);
    this.name = "ResourceError";
    this.code = code;
  }
}

/** Type guard for {@link ResourceError}. */
export function isResourceError(value: unknown): value is ResourceError {
  return value instanceof ResourceError;
}

function resourceError(code: number, message: string): ResourceError {
  return new ResourceError(code, message);
}

/**
 * Filesystem operations used by this module, abstracted so unit tests can
 * inject an in-memory implementation. Mirrors the seam in
 * {@link ./token-writer.ts}.
 */
export interface FsLike {
  realpath(path: string): Promise<string>;
  existsSync(path: string): boolean;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<Array<{ name: string; isDirectory(): boolean }>>;
}

/** Default {@link FsLike} backed by real Node APIs. */
export const NODE_FS: FsLike = {
  realpath: realpathNode,
  existsSync: existsSyncNode,
  stat: statNode,
  readFile: (path) => readFileNode(path),
  readdir: (path) => readdirNode(path, { withFileTypes: true }),
};

/**
 * Convert a `file://` URI to an absolute filesystem path.
 *
 * @throws ResourceError with `InvalidParams` for non-`file:` schemes or
 * malformed URIs.
 */
export function resourceUriToPath(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw resourceError(JsonRpcErrorCodes.InvalidParams, `Malformed URI: ${uri}`);
  }
  if (parsed.protocol !== "file:") {
    throw resourceError(
      JsonRpcErrorCodes.InvalidParams,
      `Only file:// URIs are supported, got: ${uri}`,
    );
  }
  try {
    return fileURLToPath(parsed);
  } catch {
    throw resourceError(
      JsonRpcErrorCodes.InvalidParams,
      `Cannot resolve file URI to a path: ${uri}`,
    );
  }
}

/**
 * Case- and separator-normalised containment check: is `child` equal to, or a
 * descendant of, `root`? Prevents prefix collisions (e.g. `/home/user` vs
 * `/home/username`) by requiring a trailing separator on the root.
 */
function isUnderRoot(child: string, root: string): boolean {
  const c = child.toLowerCase().replace(/\\/g, "/");
  const r = root.toLowerCase().replace(/\\/g, "/");
  const rWithSep = r.endsWith("/") ? r : `${r}/`;
  return c === r || c.startsWith(rWithSep);
}

/**
 * Resolve `targetPath` and assert it lies under at least one allowed root,
 * accounting for symlinks. Returns the realpath'd absolute path on success.
 *
 * Resolution strategy (mirrors {@link ./token-writer.ts}):
 * 1. `resolve()` the path to absolute form and reject if it isn't under any
 *    root lexically.
 * 2. realpath the nearest *existing* ancestor and re-check containment — guards
 *    against a symlinked ancestor escaping the root.
 * 3. If the target itself exists, realpath it and re-check — guards against a
 *    symlink at the target pointing outside the root.
 *
 * @throws ResourceError with `PermissionDenied` for an empty root set, a path
 * outside every root, or any symlink escape.
 */
export async function assertWithinRoots(
  targetPath: string,
  roots: Iterable<string>,
  fs: FsLike = NODE_FS,
): Promise<string> {
  const rootList = [...roots].map((r) => resolve(r));
  if (rootList.length === 0) {
    throw resourceError(AhpErrorCodes.PermissionDenied, "No accessible roots for this connection");
  }
  const resolved = resolve(targetPath);
  if (!rootList.some((root) => isUnderRoot(resolved, root))) {
    throw resourceError(
      AhpErrorCodes.PermissionDenied,
      `Path is outside the allowed roots: ${targetPath}`,
    );
  }

  // Realpath the nearest existing ancestor (which may be the target itself).
  let ancestor = resolved;
  while (!fs.existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    ancestor = dirname(ancestor);
  }
  let realAncestor: string;
  try {
    realAncestor = await fs.realpath(ancestor);
  } catch {
    throw resourceError(
      AhpErrorCodes.PermissionDenied,
      `Cannot resolve real path for: ${targetPath}`,
    );
  }
  if (!rootList.some((root) => isUnderRoot(realAncestor, root))) {
    throw resourceError(
      AhpErrorCodes.PermissionDenied,
      `Path resolves outside the allowed roots via symlink: ${targetPath}`,
    );
  }

  // If the target exists, realpath it too (the ancestor walk may have stopped
  // short of it when the full path exists) and re-check.
  if (fs.existsSync(resolved)) {
    let realTarget: string;
    try {
      realTarget = await fs.realpath(resolved);
    } catch {
      throw resourceError(
        AhpErrorCodes.PermissionDenied,
        `Cannot resolve real path for: ${targetPath}`,
      );
    }
    if (!rootList.some((root) => isUnderRoot(realTarget, root))) {
      throw resourceError(
        AhpErrorCodes.PermissionDenied,
        `Path resolves outside the allowed roots via symlink: ${targetPath}`,
      );
    }
    return realTarget;
  }
  return resolved;
}

/**
 * Map of file extension (with leading dot, lowercase) to MIME content type for
 * the subset of types the document viewer cares about. Anything not listed
 * falls back to `application/octet-stream` and is treated as binary.
 */
const CONTENT_TYPE_BY_EXT: ReadonlyMap<string, string> = new Map([
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".js", "text/plain"],
  [".jsx", "text/plain"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".css", "text/css"],
  [".html", "text/html"],
  [".xml", "application/xml"],
  [".yaml", "text/plain"],
  [".yml", "text/plain"],
  [".sh", "text/plain"],
  [".py", "text/plain"],
  [".toml", "text/plain"],
  [".csv", "text/csv"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

const DEFAULT_CONTENT_TYPE: string = "application/octet-stream";

/** Resolve a content type from a path's extension. */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPE_BY_EXT.get(extname(path).toLowerCase()) ?? DEFAULT_CONTENT_TYPE;
}

/** Whether a content type is text-ish (so its default encoding is utf-8). */
function isTextContentType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml"
  );
}

/**
 * Read a file resource. Honours the requested `encoding`; when omitted, text
 * content types default to `utf-8` and everything else to `base64`.
 *
 * @throws ResourceError — `InvalidParams` (bad URI), `PermissionDenied`
 * (sandbox), or `NotFound` (missing / not a regular file).
 */
export async function readResource(
  uri: string,
  roots: Iterable<string>,
  encoding?: ContentEncoding,
  fs: FsLike = NODE_FS,
): Promise<ResourceReadResult> {
  const requested = resourceUriToPath(uri);
  const path = await assertWithinRoots(requested, roots, fs);

  let info: { isFile(): boolean; isDirectory(): boolean };
  try {
    info = await fs.stat(path);
  } catch {
    throw resourceError(AhpErrorCodes.NotFound, `Resource does not exist: ${uri}`);
  }
  if (!info.isFile()) {
    throw resourceError(AhpErrorCodes.NotFound, `Resource is not a file: ${uri}`);
  }

  const buffer = await fs.readFile(path);
  const contentType = contentTypeFor(path);
  const useEncoding =
    encoding ?? (isTextContentType(contentType) ? ContentEncoding.Utf8 : ContentEncoding.Base64);
  const data =
    useEncoding === ContentEncoding.Utf8 ? buffer.toString("utf-8") : buffer.toString("base64");

  return { data, encoding: useEncoding, contentType };
}

/**
 * List the entries of a directory resource.
 *
 * @throws ResourceError — `InvalidParams` (bad URI), `PermissionDenied`
 * (sandbox), or `NotFound` (missing or not a directory; per the AHP spec
 * `resourceList` succeeds only if the target exists *and* is a directory).
 */
export async function listResource(
  uri: string,
  roots: Iterable<string>,
  fs: FsLike = NODE_FS,
): Promise<ResourceListResult> {
  const requested = resourceUriToPath(uri);
  const path = await assertWithinRoots(requested, roots, fs);

  let info: { isFile(): boolean; isDirectory(): boolean };
  try {
    info = await fs.stat(path);
  } catch {
    throw resourceError(AhpErrorCodes.NotFound, `Resource does not exist: ${uri}`);
  }
  if (!info.isDirectory()) {
    throw resourceError(AhpErrorCodes.NotFound, `Resource is not a directory: ${uri}`);
  }

  const dirents = await fs.readdir(path);
  const entries: DirectoryEntry[] = dirents.map((d) => ({
    name: d.name,
    type: d.isDirectory() ? "directory" : "file",
  }));
  return { entries };
}
