/**
 * Typed ConnectRPC client factory for E2E tests.
 *
 * Creates an authenticated gRPC client that talks directly to the Grackle
 * server from the Node.js test process (no browser context needed).
 */
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle } from "@grackle-ai/common";

/** Typed gRPC client for the Grackle service. */
export type GrackleClient = Client<typeof grackle.Grackle>;

/** Create an authenticated ConnectRPC client pointing at a test server. */
export function createTestClient(serverPort: number, apiKey: string): GrackleClient {
  const transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${serverPort}`,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return createClient(grackle.Grackle, transport);
}
