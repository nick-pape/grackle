/**
 * Filesystem resource watch lifecycle: create, start, stop, flush.
 * @module resource-watch
 */

import type {
  CreateResourceWatchParams,
  CreateResourceWatchResult,
  ResourceWatchChangedAction,
  ResourceWatchState,
} from "@grackle-ai/ahp";
import { ActionType, AhpErrorCodes, JsonRpcErrorCodes, ResourceChangeType } from "@grackle-ai/ahp";
import type { AhpServerConnection } from "@grackle-ai/ahp-transport";
import { watch as chokidarWatch } from "chokidar";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join as joinPath, relative as relativePath, sep as pathSep } from "node:path";
import { pathToFileURL } from "node:url";
import picomatch from "picomatch";

import type { ClientState, ResourceWatchEntry } from "./ahp-types.js";
import {
  MAX_RESOURCE_WATCHES_PER_CONNECTION,
  RESOURCE_WATCH_CHANNEL_PREFIX,
  WATCH_COALESCE_MS,
} from "./channel-codec.js";
import { logger } from "./logger.js";
import { assertWithinRoots, ResourceError, resourceUriToPath } from "./resource-fs.js";
import { COALESCE_DROP, coalesceChangeType } from "./resource-watch-coalesce.js";

/**
 * Validate an optional AHP `GlobSet` (excludes/includes) from untrusted client
 * params: it must be `undefined` or an object with an `items` array of strings.
 *
 * @throws ResourceError with `InvalidParams` for any other shape.
 */
function assertGlobSet(value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }
  const items =
    typeof value === "object" && value !== null ? (value as { items?: unknown }).items : undefined;
  if (!Array.isArray(items) || !items.every((g) => typeof g === "string")) {
    throw new ResourceError(
      JsonRpcErrorCodes.InvalidParams,
      `createResourceWatch: ${field} must be { items: string[] }`,
    );
  }
}

/**
 * Allocate a resource-watch channel for a sandbox-validated URI. The watcher
 * itself is started lazily when the client subscribes to the returned channel
 * ({@link startResourceWatch}).
 *
 * @throws ResourceError — `InvalidParams`/`PermissionDenied` (sandbox) or
 * `NotFound` if the watch target does not exist.
 */
export async function createResourceWatchEntry(
  params: CreateResourceWatchParams,
  cState: ClientState,
): Promise<CreateResourceWatchResult> {
  if (cState.watches.size >= MAX_RESOURCE_WATCHES_PER_CONNECTION) {
    throw new ResourceError(
      JsonRpcErrorCodes.InvalidParams,
      `Too many active resource watches (max ${MAX_RESOURCE_WATCHES_PER_CONNECTION})`,
    );
  }
  assertGlobSet(params.excludes, "excludes");
  assertGlobSet(params.includes, "includes");
  const rootPath = await assertWithinRoots(resourceUriToPath(params.uri), cState.allowedRoots);
  if (!existsSync(rootPath)) {
    throw new ResourceError(AhpErrorCodes.NotFound, `Watch target does not exist: ${params.uri}`);
  }
  const channel = `${RESOURCE_WATCH_CHANNEL_PREFIX}${randomUUID()}`;
  const descriptor: ResourceWatchState = {
    root: params.uri,
    recursive: params.recursive ?? false,
    ...(params.excludes !== undefined ? { excludes: params.excludes } : {}),
    ...(params.includes !== undefined ? { includes: params.includes } : {}),
  };
  cState.watches.set(channel, { rootPath, descriptor, serverSeq: 0, pending: new Map() });
  return { channel };
}

/**
 * Flush the coalesced change batch for a watch as a single
 * `resourceWatch/changed` action. Never dispatches an empty batch (per spec).
 */
export function flushResourceWatch(
  conn: AhpServerConnection,
  channel: string,
  entry: ResourceWatchEntry,
): void {
  entry.flushTimer = undefined;
  if (entry.stopped === true || entry.pending.size === 0) {
    return;
  }
  const items = [...entry.pending.values()];
  entry.pending.clear();
  const action: ResourceWatchChangedAction = {
    type: ActionType.ResourceWatchChanged,
    changes: { items },
  };
  conn.session.notify("action", {
    channel,
    serverSeq: entry.serverSeq++,
    action,
    origin: undefined,
  });
}

/**
 * Start the chokidar watcher for a previously-created watch entry and wire its
 * events into coalesced `resourceWatch/changed` notifications. Idempotent: a
 * second subscribe to the same channel is a no-op.
 */
export function startResourceWatch(
  conn: AhpServerConnection,
  channel: string,
  entry: ResourceWatchEntry,
): void {
  if (entry.watcher !== undefined) {
    return;
  }
  entry.stopped = false;
  const { rootPath, descriptor } = entry;
  const excludeMatchers = (descriptor.excludes?.items ?? []).map((g) => picomatch(g));
  const includeMatchers = (descriptor.includes?.items ?? []).map((g) => picomatch(g));
  const relForMatch = (p: string): string => relativePath(rootPath, p).split(pathSep).join("/");

  const lexicalRoot = resourceUriToPath(descriptor.root);
  const emitUriFor = (changedPath: string): string => {
    const rel = relativePath(rootPath, changedPath);
    const lexicalPath = rel === "" ? lexicalRoot : joinPath(lexicalRoot, rel);
    return pathToFileURL(lexicalPath).href;
  };

  const watcher = chokidarWatch(rootPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    followSymlinks: false,
    ignored: (p: string): boolean => {
      if (p.split(pathSep).includes(".git")) {
        return true;
      }
      if (excludeMatchers.length === 0) {
        return false;
      }
      const rel = relForMatch(p);
      return rel !== "" && excludeMatchers.some((m) => m(rel));
    },
    depth: descriptor.recursive ? undefined : 0,
  });
  entry.watcher = watcher;

  const record =
    (type: ResourceChangeType): ((changedPath: string) => void) =>
    (changedPath: string): void => {
      if (entry.stopped === true) {
        return;
      }
      if (includeMatchers.length > 0) {
        const rel = relForMatch(changedPath);
        if (rel !== "" && !includeMatchers.some((m) => m(rel))) {
          return;
        }
      }
      const uri = emitUriFor(changedPath);
      const next = coalesceChangeType(entry.pending.get(uri)?.type, type);
      if (next === COALESCE_DROP) {
        entry.pending.delete(uri);
      } else {
        entry.pending.set(uri, { uri, type: next });
      }
      if (entry.pending.size > 0 && entry.flushTimer === undefined) {
        entry.flushTimer = setTimeout(() => {
          flushResourceWatch(conn, channel, entry);
        }, WATCH_COALESCE_MS);
      }
    };

  watcher.on("add", record(ResourceChangeType.Added));
  watcher.on("addDir", record(ResourceChangeType.Added));
  watcher.on("change", record(ResourceChangeType.Updated));
  watcher.on("unlink", record(ResourceChangeType.Deleted));
  watcher.on("unlinkDir", record(ResourceChangeType.Deleted));
  watcher.on("error", (err: unknown): void => {
    logger.error({ err, channel }, "Resource watch error; tearing down watch");
    stopResourceWatch(entry);
  });
}

/** Release a watch's filesystem resources (watcher + pending flush timer). */
export function stopResourceWatch(entry: ResourceWatchEntry): void {
  entry.stopped = true;
  if (entry.flushTimer !== undefined) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = undefined;
  }
  entry.pending.clear();
  const w = entry.watcher;
  if (w !== undefined) {
    for (const ev of ["add", "addDir", "change", "unlink", "unlinkDir", "error"]) {
      w.removeAllListeners(ev);
    }
    w.close().catch(() => undefined);
  }
  entry.watcher = undefined;
}
