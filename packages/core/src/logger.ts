import pino, { type Logger } from "pino";
import { resolveLogConfig, type LogConfig } from "@grackle-ai/common";
import { getTraceId } from "./trace-context.js";

/** Pino mixin that auto-injects the active traceId into every log line. */
export function createLoggerMixin(): object {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

const logConfig: Readonly<LogConfig> = resolveLogConfig();

/** Application logger for the Grackle server. */
export const logger: Logger = pino({
  name: "grackle-server",
  level: logConfig.level,
  mixin: createLoggerMixin,
  transport: !logConfig.isProduction
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});
