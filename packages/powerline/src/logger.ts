import pino from "pino";

/** Application logger for the Grackle PowerLine. */
export const logger = pino({
  name: "grackle-powerline",
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});
