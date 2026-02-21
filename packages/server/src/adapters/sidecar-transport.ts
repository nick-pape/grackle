import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { sidecar } from "@grackle/common";
import type { SidecarClient } from "./adapter.js";

/**
 * Create an authenticated gRPC client for a sidecar.
 * The sidecar token is sent as a Bearer token on every request.
 */
export function createSidecarClient(baseUrl: string, sidecarToken: string): SidecarClient {
  const transport = createGrpcTransport({
    baseUrl,
    interceptors: sidecarToken
      ? [
          (next) => async (req) => {
            req.header.set("Authorization", `Bearer ${sidecarToken}`);
            return next(req);
          },
        ]
      : [],
  });
  return createClient(sidecar.GrackleSidecar, transport);
}
