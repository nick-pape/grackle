import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle, DEFAULT_SERVER_PORT } from "@grackle/common";

export function createGrackleClient(serverUrl?: string) {
  const url = serverUrl || process.env.GRACKLE_URL || `http://localhost:${DEFAULT_SERVER_PORT}`;
  const transport = createGrpcTransport({ baseUrl: url });
  return createClient(grackle.Grackle, transport);
}
