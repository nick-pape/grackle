/**
 * Shared pino logger factory for all Grackle server-side packages.
 *
 * @module
 */

import pino, { type Logger } from "pino";
import { resolveLogConfig } from "./config.js";

/** Options for {@link createPinoLogger}. */
export interface CreatePinoLoggerOptions {
  /** Logger `name` field (e.g. `"grackle-server"`). */
  name: string;
  /** Optional pino mixin function (e.g. for traceId injection). */
  mixin?: () => object;
}

/**
 * Create a pino logger with Grackle's standard level and transport config.
 *
 * Level is read from `LOG_LEVEL` (validated; invalid values fall back to `"info"`).
 * In non-production environments the pretty `pino/file` transport is used.
 */
export function createPinoLogger(options: CreatePinoLoggerOptions): Logger {
  const logConfig = resolveLogConfig();
  return pino({
    name: options.name,
    level: logConfig.level,
    mixin: options.mixin,
    transport: !logConfig.isProduction
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
  });
}

export type { Logger } from "pino";
