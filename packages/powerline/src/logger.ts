import { type Logger, createPinoLogger } from "@grackle-ai/common";
import { getTraceId } from "./trace-context.js";

/** Pino mixin that auto-injects the active traceId into every log line. */
function createLoggerMixin(): object {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

/** Application logger for the Grackle PowerLine. */
export const logger: Logger = createPinoLogger({
  name: "grackle-powerline",
  mixin: createLoggerMixin,
});
