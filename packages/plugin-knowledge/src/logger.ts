import type { Logger } from "pino";
import { logger as coreLogger } from "@grackle-ai/core";

/** Structured logger for the knowledge plugin — child of the core logger. */
export const logger: Logger = coreLogger.child({ name: "grackle-plugin-knowledge" });
