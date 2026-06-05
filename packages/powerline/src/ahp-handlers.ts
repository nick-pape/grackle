/**
 * PowerLine AHP handlers (AHP HR8d / #1336).
 *
 * Mounts an {@link AhpServerSocket} on an existing HTTP/HTTP2 server and
 * routes incoming AHP JSON-RPC requests + notifications to the handler
 * modules. This file is the glue layer — individual handler logic lives in
 * the `handlers/` directory and domain modules (`forwarder.ts`,
 * `resource-watch.ts`).
 *
 * @module ahp-handlers
 */

import type {
  AhpNotification,
  AhpRequest,
  AhpResponse,
  AuthenticateParams,
  CreateResourceWatchParams,
  CreateSessionParams,
  DispatchActionParams,
  DisposeSessionParams,
  InitializeParams,
  ListSessionsParams,
  ResourceListParams,
  ResourceReadParams,
  SubscribeParams,
} from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import { AhpServerSocket, type AhpServerConnection } from "@grackle-ai/ahp-transport";

import type { ClientState } from "./ahp-types.js";
import { getOrCreateClientState } from "./ahp-types.js";
export type { MountAhpServerOptions } from "./ahp-types.js";
import type { MountAhpServerOptions } from "./ahp-types.js";
import { RESOURCE_WATCH_CHANNEL_PREFIX } from "./channel-codec.js";
import { handleAuthenticate, handleDispatchAction } from "./handlers/action-handlers.js";
import {
  handleCreateSession,
  handleDisposeSession,
  handleInitialize,
  handleListSessions,
} from "./handlers/session-handlers.js";
import { handleSubscribe } from "./handlers/subscribe-handlers.js";
import { isResourceError, listResource, readResource } from "./resource-fs.js";
import { createResourceWatchEntry, stopResourceWatch } from "./resource-watch.js";
import {
  deleteSessionPump,
  getSession,
  getSessionPump,
  parkSession,
  removeSession,
} from "./session-mgr.js";

/**
 * Mount the AHP server on the given HTTP server, wiring all the PowerLine
 * handlers. Returns the {@link AhpServerSocket} so the caller can close it.
 *
 * @param opts - Mount configuration.
 * @returns The mounted server socket.
 */
export function mountAhpServer(opts: MountAhpServerOptions): AhpServerSocket {
  const clients: Map<string, ClientState> = new Map();

  function clientState(conn: AhpServerConnection): ClientState {
    return getOrCreateClientState(clients, conn.clientId);
  }

  function jsonRpcError(req: AhpRequest, code: number, message: string): AhpResponse {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code, message },
    } satisfies AhpResponse;
  }

  function jsonRpcSuccess<T>(req: AhpRequest, result: T): AhpResponse {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result,
    } as AhpResponse;
  }

  function resourceErrorToResponse(req: AhpRequest, err: unknown): AhpResponse {
    if (isResourceError(err)) {
      return jsonRpcError(req, err.code, err.message);
    }
    return jsonRpcError(
      req,
      JsonRpcErrorCodes.InternalError,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ─── AhpServerSocket wiring ───────────────────────────────────

  const ahp = new AhpServerSocket({
    server: opts.server,
    powerlineToken: opts.powerlineToken,
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    onInitialize: (params: InitializeParams) => handleInitialize(params),

    onRequest: async (req: AhpRequest, conn: AhpServerConnection): Promise<AhpResponse> => {
      const method = req.method;
      switch (method) {
        case "createSession": {
          const resp = handleCreateSession(
            req.params as CreateSessionParams,
            conn,
            clientState(conn),
            clients,
          );
          if (resp !== undefined) {
            return { ...resp, id: req.id };
          }
          return jsonRpcSuccess(req, null);
        }
        case "subscribe": {
          const resp = handleSubscribe(
            req.params as SubscribeParams,
            conn,
            clientState(conn),
            clients,
          );
          return { ...resp, id: req.id };
        }
        case "disposeSession": {
          const resp = handleDisposeSession(req.params as DisposeSessionParams, conn, clients);
          return { ...resp, id: req.id };
        }
        case "listSessions":
          return jsonRpcSuccess(req, handleListSessions(req.params as ListSessionsParams));
        case "authenticate": {
          const result = await handleAuthenticate(req.params as AuthenticateParams);
          if ("_error" in result) {
            return jsonRpcError(req, JsonRpcErrorCodes.InvalidParams, result._error);
          }
          return jsonRpcSuccess(req, result);
        }
        case "ping":
          return jsonRpcSuccess(req, null);
        case "resourceRead": {
          const p = req.params as ResourceReadParams;
          try {
            return jsonRpcSuccess(
              req,
              await readResource(p.uri, clientState(conn).allowedRoots, p.encoding),
            );
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        case "resourceList": {
          const p = req.params as ResourceListParams;
          try {
            return jsonRpcSuccess(req, await listResource(p.uri, clientState(conn).allowedRoots));
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        case "createResourceWatch": {
          try {
            return jsonRpcSuccess(
              req,
              await createResourceWatchEntry(
                req.params as CreateResourceWatchParams,
                clientState(conn),
              ),
            );
          } catch (err) {
            return resourceErrorToResponse(req, err);
          }
        }
        default:
          return jsonRpcError(req, JsonRpcErrorCodes.MethodNotFound, `Unknown method: ${method}`);
      }
    },

    onNotification: (notif: AhpNotification, conn: AhpServerConnection): void => {
      if (notif.method === "dispatchAction") {
        handleDispatchAction(notif.params as DispatchActionParams);
        return;
      }
      if (notif.method === "unsubscribe") {
        const channel = (notif.params as { channel?: string }).channel;
        if (channel?.startsWith(RESOURCE_WATCH_CHANNEL_PREFIX) === true) {
          const cState = clients.get(conn.clientId);
          if (cState !== undefined) {
            const entry = cState.watches.get(channel);
            if (entry !== undefined) {
              stopResourceWatch(entry);
              cState.watches.delete(channel);
            }
          }
        }
      }
    },

    onDisconnect: (clientId: string): void => {
      const cState = clients.get(clientId);
      if (cState === undefined) {
        return;
      }
      for (const sessionId of cState.sessionIds) {
        const session = getSession(sessionId);
        const pump = getSessionPump(sessionId);
        const fwd = cState.forwarders.get(sessionId);
        if (session !== undefined && pump !== undefined) {
          session.kill("disconnected");
          const stillInRuntimeQueue = session.drainBufferedEvents();
          const fromAbs = fwd?.pos ?? pump.bufferStartIndex;
          const localStart = Math.max(0, fromAbs - pump.bufferStartIndex);
          const tail = [...pump.buffer.slice(localStart), ...stillInRuntimeQueue];
          if (tail.length > 0) {
            parkSession(sessionId, tail);
          }
          removeSession(sessionId);
          deleteSessionPump(sessionId);
        }
        if (fwd !== undefined) {
          fwd.cancelled = true;
          fwd.wake?.();
        }
      }
      for (const entry of cState.watches.values()) {
        stopResourceWatch(entry);
      }
      cState.watches.clear();
      clients.delete(clientId);
    },
  });

  return ahp;
}
