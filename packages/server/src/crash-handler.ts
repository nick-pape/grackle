import { logger } from "@grackle-ai/core";
import { sqlite, stopWalCheckpointTimer } from "@grackle-ai/database";

/**
 * Handle a fatal error: log it, checkpoint WAL to flush pending writes, and exit.
 * Designed for use in `uncaughtException` and `unhandledRejection` handlers.
 *
 * Does NOT call the async `shutdown()` function — the server may be in a broken
 * state, and shutdown's server-close callbacks could hang. This handler is
 * synchronous and fast.
 *
 * @param err - The error or rejection reason.
 * @param label - Human-readable label for the log message (e.g. "Uncaught exception").
 */
export function handleFatalError(err: unknown, label: string): void {
  logger.fatal({ err }, "%s — flushing WAL and exiting", label);
  stopWalCheckpointTimer();
  if (sqlite) {
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Best effort — the database may already be broken
    }
  }
  process.exit(1);
}

/**
 * Register global `uncaughtException` and `unhandledRejection` handlers.
 * Call once at startup, before `main()`, so crashes during initialization
 * are also caught.
 */
export function registerCrashHandlers(): void {
  process.on("uncaughtException", (err) => handleFatalError(err, "Uncaught exception"));
  process.on("unhandledRejection", (reason) => handleFatalError(reason, "Unhandled rejection"));
}
