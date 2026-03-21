/**
 * Neo4j driver singleton — connection management, health checks, and shutdown.
 *
 * Follows the same singleton pattern as `packages/server/src/db.ts`.
 * Call {@link openNeo4j} once at startup, then use {@link getDriver} or
 * {@link getSession} for queries, and {@link closeNeo4j} on shutdown.
 *
 * @module
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";
import { logger } from "./logger.js";
import {
  DEFAULT_NEO4J_URL,
  DEFAULT_NEO4J_USER,
  DEFAULT_NEO4J_PASSWORD,
  DEFAULT_NEO4J_DATABASE,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the Neo4j connection. */
export interface Neo4jClientConfig {
  /** Bolt URL (default: bolt://localhost:7687). */
  url?: string;
  /** Username (default: neo4j). */
  username?: string;
  /** Password (default: grackle-dev). */
  password?: string;
  /** Neo4j database name (default: neo4j). */
  database?: string;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** Module-level singleton driver instance. */
let driver: Driver | undefined;

/** The database name used when creating sessions. */
let databaseName: string = DEFAULT_NEO4J_DATABASE;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a connection to Neo4j.
 *
 * Reads configuration from environment variables first, then from the
 * provided {@link Neo4jClientConfig}, then from built-in defaults.
 *
 * Idempotent — returns silently if a connection is already open.
 *
 * | Env Variable             | Fallback            |
 * |--------------------------|---------------------|
 * | `GRACKLE_NEO4J_URL`      | `config.url`        |
 * | `GRACKLE_NEO4J_USER`     | `config.username`   |
 * | `GRACKLE_NEO4J_PASSWORD`  | `config.password`   |
 * | `GRACKLE_NEO4J_DATABASE` | `config.database`   |
 */
export async function openNeo4j(config?: Neo4jClientConfig): Promise<void> {
  if (driver) {
    return;
  }

  const url =
    process.env.GRACKLE_NEO4J_URL || config?.url || DEFAULT_NEO4J_URL;
  const username =
    process.env.GRACKLE_NEO4J_USER || config?.username || DEFAULT_NEO4J_USER;
  const password =
    process.env.GRACKLE_NEO4J_PASSWORD ||
    config?.password ||
    DEFAULT_NEO4J_PASSWORD;
  databaseName =
    process.env.GRACKLE_NEO4J_DATABASE ||
    config?.database ||
    DEFAULT_NEO4J_DATABASE;

  logger.info({ url, database: databaseName }, "Connecting to Neo4j");

  driver = neo4j.driver(url, neo4j.auth.basic(username, password), {
    disableLosslessIntegers: true,
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 30_000,
  });

  try {
    await driver.verifyConnectivity({ database: databaseName });
    logger.info("Neo4j connectivity verified");
  } catch (error) {
    // Clean up so a subsequent call to openNeo4j() can retry.
    const failedDriver = driver;
    driver = undefined;
    await failedDriver.close().catch(() => {});
    throw new Error(
      `Failed to connect to Neo4j at ${url}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Ensure Neo4j is running and the credentials are correct.",
    );
  }
}

/**
 * Get a Neo4j session for running queries.
 *
 * Sessions are lightweight and should be short-lived — open one per
 * logical unit of work and close it when done.
 *
 * @throws If {@link openNeo4j} has not been called.
 */
export function getSession(): Session {
  if (!driver) {
    throw new Error("Neo4j not initialized. Call openNeo4j() first.");
  }
  return driver.session({ database: databaseName });
}

/**
 * Get the raw Neo4j driver instance.
 *
 * Prefer {@link getSession} for most use cases. Use the driver directly
 * only when you need `driver.executeQuery()` for simple one-shot queries.
 *
 * @throws If {@link openNeo4j} has not been called.
 */
export function getDriver(): Driver {
  if (!driver) {
    throw new Error("Neo4j not initialized. Call openNeo4j() first.");
  }
  return driver;
}

/**
 * Check Neo4j connectivity.
 *
 * @returns `true` if the connection is healthy, `false` otherwise.
 */
export async function healthCheck(): Promise<boolean> {
  if (!driver) {
    return false;
  }
  try {
    await driver.verifyConnectivity({ database: databaseName });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the Neo4j connection and release resources.
 *
 * Safe to call multiple times or when no connection is open.
 */
export async function closeNeo4j(): Promise<void> {
  const current = driver;
  if (current) {
    driver = undefined;
    logger.info("Closing Neo4j connection");
    await current.close();
  }
}
