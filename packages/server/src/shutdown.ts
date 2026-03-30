import { logger } from "@grackle-ai/core";
import type { Disposable } from "@grackle-ai/core";
import { sqlite, stopWalCheckpointTimer } from "@grackle-ai/database";
import { stopPairingCleanup, stopSessionCleanup, stopOAuthCleanup } from "@grackle-ai/auth";
import { closeAllTunnels } from "@grackle-ai/adapter-sdk";

/** Hard timeout (ms) so upgraded WS connections don't block exit. */
const SHUTDOWN_TIMEOUT_MS: number = 5_000;

/** Minimal server interface — only the `.close()` method is needed for shutdown. */
interface Closeable {
  close: (cb: (err?: Error) => void) => void;
}

/** Resources that must be cleaned up during graceful shutdown. */
export interface ShutdownContext {
  /** The HTTP/2 gRPC server. */
  grpcServer: Closeable;
  /** The HTTP/1.1 web + WebSocket server. */
  webServer: Closeable;
  /** The HTTP/1.1 MCP server. */
  mcpServer: Closeable;
  /** The reconciliation manager (cron, orphan, lifecycle phases). */
  reconciliationManager: { stop: () => Promise<void> };
  /** The local PowerLine child-process manager, if running. */
  localPowerLineManager?: { stop: () => Promise<void> };
  /** Optional knowledge graph cleanup function. */
  knowledgeCleanup?: () => Promise<void>;
  /** Active event subscribers to dispose on shutdown. */
  subscribers?: Disposable[];
}

/**
 * Create a graceful shutdown function that closes all server resources.
 *
 * The returned function stops timers, closes servers, flushes the WAL, and
 * exits the process. A hard timeout forces exit if shutdown hangs.
 *
 * @param context - All resources that need cleanup.
 * @returns An async shutdown function suitable for SIGINT/SIGTERM handlers.
 */
export function createShutdown(context: ShutdownContext): () => Promise<void> {
  return async function shutdown(): Promise<void> {
    logger.info("Shutting down...");
    stopWalCheckpointTimer();
    stopPairingCleanup();
    stopSessionCleanup();
    stopOAuthCleanup();
    await context.reconciliationManager.stop();

    // Dispose all event subscribers so handlers don't fire during teardown
    if (context.subscribers) {
      for (const subscriber of context.subscribers) {
        subscriber.dispose();
      }
    }

    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Stop the local PowerLine child process first
    if (context.localPowerLineManager) {
      await context.localPowerLineManager.stop();
    }

    if (context.knowledgeCleanup) {
      try {
        await context.knowledgeCleanup();
      } catch (err) {
        logger.error({ err }, "Error while shutting down knowledge graph");
      }
    }

    await closeAllTunnels();

    await new Promise<void>((resolve) => {
      context.grpcServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing gRPC server");
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      context.webServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing web server");
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      context.mcpServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing MCP server");
        }
        resolve();
      });
    });

    // Final WAL checkpoint (TRUNCATE) to fully flush pending writes before exit
    if (sqlite) {
      try {
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
      } catch (err) {
        logger.error({ err }, "Error during final WAL checkpoint");
      }
    }
    clearTimeout(forceExit);
    process.exit(process.exitCode || 0);
  };
}
