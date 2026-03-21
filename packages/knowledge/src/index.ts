/**
 * Knowledge graph subsystem for Grackle.
 *
 * Provides structured knowledge storage and retrieval via Neo4j, enabling
 * agents to share and reuse contextual information across sessions.
 *
 * @packageDocumentation
 */

export { openNeo4j, closeNeo4j, healthCheck, getSession, getDriver } from "./client.js";
export type { Neo4jClientConfig } from "./client.js";
export { initSchema, SCHEMA_STATEMENTS } from "./schema.js";
export * from "./types.js";
export * from "./constants.js";
