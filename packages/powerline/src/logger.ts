import pino, { type Logger } from "pino";
import { getTraceId } from "./trace-context.js";

/** Pino mixin that auto-injects the active traceId into every log line. */
function createLoggerMixin(): object {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

/** Application logger for the Grackle PowerLine. */
export const logger: Logger = pino({
  name: "grackle-powerline",
  level: process.env.LOG_LEVEL || "info",
  mixin: createLoggerMixin,
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});
