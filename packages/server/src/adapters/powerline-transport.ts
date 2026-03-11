import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { powerline } from "@grackle-ai/common";
import type { PowerLineClient } from "./adapter.js";

/**
 * Create an authenticated gRPC client for a PowerLine.
 * The PowerLine token is sent as a Bearer token on every request.
 */
export function createPowerLineClient(baseUrl: string, powerlineToken: string): PowerLineClient {
  const transport = createGrpcTransport({
    baseUrl,
    interceptors: powerlineToken
      ? [
          (next) => async (req) => {
            req.header.set("Authorization", `Bearer ${powerlineToken}`);
            return next(req);
          },
        ]
      : [],
  });
  return createClient(powerline.GracklePowerLine, transport);
}
