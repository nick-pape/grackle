import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle, DEFAULT_SERVER_PORT, GRACKLE_DIR, API_KEY_FILENAME } from "@grackle/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function loadApiKey(): string {
  const grackleHome = process.env.GRACKLE_HOME
    ? join(process.env.GRACKLE_HOME, GRACKLE_DIR)
    : join(homedir(), GRACKLE_DIR);
  const keyPath = join(grackleHome, API_KEY_FILENAME);
  try {
    return readFileSync(keyPath, "utf8").trim();
  } catch {
    console.error(`Warning: Could not read API key from ${keyPath}`);
    return "";
  }
}

/** Create an authenticated ConnectRPC client for the central Grackle server. */
export function createGrackleClient(serverUrl?: string) {
  const url = serverUrl || process.env.GRACKLE_URL || `http://localhost:${DEFAULT_SERVER_PORT}`;
  const apiKey = process.env.GRACKLE_API_KEY || loadApiKey();
  const transport = createGrpcTransport({
    baseUrl: url,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return createClient(grackle.Grackle, transport);
}
