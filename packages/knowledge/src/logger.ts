/**
 * Structured logger for the knowledge graph subsystem.
 *
 * @module
 */

import pino, { type Logger } from "pino";

/** Pino logger instance for the knowledge package. */
export const logger: Logger = pino({
  name: "grackle-knowledge",
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});
