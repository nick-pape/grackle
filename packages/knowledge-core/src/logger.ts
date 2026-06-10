/**
 * Structured logger for the knowledge graph subsystem.
 *
 * @module
 */

import { type Logger, createPinoLogger } from "@grackle-ai/common";

/** Pino logger instance for the knowledge package. */
export const logger: Logger = createPinoLogger({ name: "grackle-knowledge" });
