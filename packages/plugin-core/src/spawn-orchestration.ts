/**
 * Shared spawn orchestration utilities extracted from session-handlers and
 * task-handlers. Encapsulates the post-session-creation wiring that both
 * `spawnAgent` and `startTask` share: lifecycle streams, stdin, IPC pipes,
 * event processing, and response building.
 *
 * @module
 */

import type { PipeMode } from "@grackle-ai/common";
import { DEFAULT_MCP_PORT } from "@grackle-ai/common";
import type { ServerActionEnvelope } from "@grackle-ai/adapter-sdk";
import { getDatabaseStores } from "@grackle-ai/database";
import {
  streamRegistry,
  pipeDelivery,
  processEventStream,
  ensureStdinStream,
  type EventStreamOptions,
} from "@grackle-ai/core";
import { toDialableHost } from "./grpc-shared.js";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import type { grackle } from "@grackle-ai/common";

/** Build the MCP endpoint URL from environment variables or defaults. */
export function buildMcpUrl(): string {
  const port = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const host = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  return `http://${host}:${port}/mcp`;
}

/** Parameters for the shared post-creation spawn wiring. */
export interface SpawnTailParams {
  sessionId: string;
  parentSessionId: string;
  pipeMode: PipeMode | "";
  transportStream: AsyncIterable<ServerActionEnvelope>;
  eventContext: EventStreamOptions;
}

/**
 * Execute the shared spawn tail: lifecycle stream, stdin, IPC pipes,
 * event processing, and proto response assembly. Both `spawnAgent` and
 * `startTask` call this after creating the session row and transport stream.
 */
export function executeSpawnTail(params: SpawnTailParams): grackle.Session {
  const { sessionStore } = getDatabaseStores();
  const { sessionId, parentSessionId, pipeMode, transportStream, eventContext } = params;

  const lifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  const spawnerId = parentSessionId || "__server__";
  streamRegistry.subscribe(lifecycleStream.id, spawnerId, "rw", "detach", true);
  streamRegistry.subscribe(lifecycleStream.id, sessionId, "rw", "detach", false);

  ensureStdinStream(sessionId);

  let pipeFd = 0;
  if (pipeMode && pipeMode !== "detach" && parentSessionId) {
    const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
    const parentSub = streamRegistry.subscribe(
      ipcStream.id,
      parentSessionId,
      "rw",
      pipeMode === "sync" ? "sync" : "async",
      true,
    );
    streamRegistry.subscribe(ipcStream.id, sessionId, "rw", "async", false);
    pipeFd = parentSub.fd;

    if (pipeMode === "async") {
      pipeDelivery.ensureAsyncDeliveryListener(parentSessionId);
      pipeDelivery.ensureAsyncDeliveryListener(sessionId);
    }
  }

  processEventStream(transportStream, eventContext);

  const row = sessionStore.getSession(sessionId);
  const proto = sessionRowToProto(row!);
  proto.pipeFd = pipeFd;
  return proto;
}
