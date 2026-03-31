/**
 * ConnectRPC clients for calling the Grackle gRPC services from the browser.
 *
 * Uses the Connect protocol over HTTP/1.1 (same-origin requests to the web
 * server on port 3000), with session cookie auth sent automatically.
 *
 * @module
 */

import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { grackle } from "@grackle-ai/common";

/**
 * Custom fetch function that delegates to `globalThis.fetch` at call time.
 *
 * E2E tests monkey-patch `window.fetch` via `page.evaluate()`. ConnectRPC's
 * `createConnectTransport` would normally capture the `fetch` reference at
 * creation time. By passing this wrapper, the transport always reads the
 * current `globalThis.fetch`, making test patches visible.
 */
const customFetch: typeof globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(_target: typeof globalThis.fetch, thisArg: unknown, args: Parameters<typeof globalThis.fetch>): Promise<Response> {
    return Reflect.apply(globalThis.fetch, thisArg, args) as Promise<Response>;
  },
});

/** Reusable Connect transport — stateless singleton. */
const transport: ReturnType<typeof createConnectTransport> = createConnectTransport({
  baseUrl: "/",
  fetch: customFetch as typeof globalThis.fetch,
});

/** Typed ConnectRPC client for core RPCs (environments, sessions, workspaces, etc.). */
export const coreClient: Client<typeof grackle.GrackleCore> = createClient(grackle.GrackleCore, transport);

/** Typed ConnectRPC client for orchestration RPCs (tasks, personas, findings, escalations). */
export const orchestrationClient: Client<typeof grackle.GrackleOrchestration> = createClient(grackle.GrackleOrchestration, transport);

/** Typed ConnectRPC client for scheduling RPCs. */
export const schedulingClient: Client<typeof grackle.GrackleScheduling> = createClient(grackle.GrackleScheduling, transport);

/** Typed ConnectRPC client for knowledge graph RPCs. */
export const knowledgeClient: Client<typeof grackle.GrackleKnowledge> = createClient(grackle.GrackleKnowledge, transport);
