import pino, { type Logger } from "pino";

/** Application logger for the Grackle server. */
export const logger: Logger = pino({
  name: "grackle-server",
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string means "not set"
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});
