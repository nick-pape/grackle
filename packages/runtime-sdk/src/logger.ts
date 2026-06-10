import { type Logger, createPinoLogger } from "@grackle-ai/common";

/** Application logger for Grackle runtime packages. */
export const logger: Logger = createPinoLogger({ name: "grackle-runtime" });
