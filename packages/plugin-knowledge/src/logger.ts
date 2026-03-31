import pino from "pino";

/** Structured logger for the knowledge plugin. */
export const logger: pino.Logger = pino({ name: "grackle-plugin-knowledge" });
