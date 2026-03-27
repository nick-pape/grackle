import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle, DEFAULT_SERVER_PORT, GRACKLE_DIR, API_KEY_FILENAME } from "@grackle-ai/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/** Load the API key from the on-disk key file under `GRACKLE_HOME` (or `~/.grackle`). */
export function loadApiKey(): string {
  const grackleHome = process.env.GRACKLE_HOME
    ? join(process.env.GRACKLE_HOME, GRACKLE_DIR)
    : join(homedir(), GRACKLE_DIR);
  const keyPath = join(grackleHome, API_KEY_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(keyPath, "utf8");
  } catch {
    throw new Error(`Could not read API key from ${keyPath}\nRun "grackle serve" first to generate a key, or set GRACKLE_API_KEY.`);
  }
  const key = raw.trim();
  if (!key) {
    throw new Error(`API key file is empty: ${keyPath}\nRun "grackle serve" first to generate a key.`);
  }
  return key;
}

/** Create an authenticated ConnectRPC client for the central Grackle server. */
export function createGrackleClient(serverUrl?: string, apiKey?: string): Client<typeof grackle.Grackle> {
  const url = serverUrl || process.env.GRACKLE_URL || `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
  const resolvedApiKey = apiKey ?? process.env.GRACKLE_API_KEY ?? loadApiKey();
  const transport = createGrpcTransport({
    baseUrl: url,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${resolvedApiKey}`);
        req.header.set("x-trace-id", randomUUID());
        return next(req);
      },
    ],
  });
  return createClient(grackle.Grackle, transport);
}
