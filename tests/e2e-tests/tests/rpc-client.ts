/**
 * Typed ConnectRPC client factory for E2E tests.
 *
 * Creates authenticated per-service gRPC clients that talk directly to the
 * Grackle server from the Node.js test process (no browser context needed).
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle } from "@grackle-ai/common";
import type { Client } from "@connectrpc/connect";

/** Per-service ConnectRPC clients for E2E tests. */
export interface GrackleClients {
  /** Core RPCs: environments, sessions, workspaces, tokens, settings, etc. */
  core: Client<typeof grackle.GrackleCore>;
  /** Orchestration RPCs: tasks, personas, findings, escalations. */
  orchestration: Client<typeof grackle.GrackleOrchestration>;
  /** Scheduling RPCs. */
  scheduling: Client<typeof grackle.GrackleScheduling>;
  /** Knowledge graph RPCs. */
  knowledge: Client<typeof grackle.GrackleKnowledge>;
}

/** Type alias for backward compatibility in helper function signatures. */
export type GrackleClient = GrackleClients;

/** Create authenticated ConnectRPC clients pointing at a test server. */
export function createTestClient(serverPort: number, apiKey: string): GrackleClients {
  const transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${serverPort}`,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return {
    core: createClient(grackle.GrackleCore, transport),
    orchestration: createClient(grackle.GrackleOrchestration, transport),
    scheduling: createClient(grackle.GrackleScheduling, transport),
    knowledge: createClient(grackle.GrackleKnowledge, transport),
  };
}
