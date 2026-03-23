/**
 * ConnectRPC client for calling the Grackle gRPC service from the browser.
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

/** Typed ConnectRPC client for the Grackle service. */
export const grackleClient: Client<typeof grackle.Grackle> = createClient(grackle.Grackle, transport);

/** Re-export the Client type for hooks that accept the client as a parameter. */
export type GrackleClient = Client<typeof grackle.Grackle>;
