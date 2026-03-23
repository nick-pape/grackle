/**
 * ConnectRPC client for calling the Grackle gRPC service from the browser.
 *
 * Uses the Connect protocol over HTTP/1.1 (same-origin requests to the web
 * server on port 3000), with session cookie auth sent automatically via
 * `credentials: "include"`.
 *
 * @module
 */

import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { grackle } from "@grackle-ai/common";

/** Reusable Connect transport — stateless singleton.
 *  Same-origin requests send the session cookie automatically. */
const transport: ReturnType<typeof createConnectTransport> = createConnectTransport({
  baseUrl: "/",
});

/** Typed ConnectRPC client for the Grackle service. */
export const grackleClient: Client<typeof grackle.Grackle> = createClient(grackle.Grackle, transport);

/** Re-export the Client type for hooks that accept the client as a parameter. */
export type GrackleClient = Client<typeof grackle.Grackle>;
