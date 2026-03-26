import pino, { type Logger } from "pino";

/** Application logger for Grackle runtime packages. */
export const logger: Logger = pino({
  name: "grackle-runtime",
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});
