import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger } from "@opentelemetry/api-logs";
import { grackle, eventTypeToString } from "@grackle-ai/common";
import { logger } from "./logger.js";
import { getTraceId } from "./trace-context.js";

/**
 * AHP HR7 — additive OpenTelemetry logs sink for runtime diagnostics.
 *
 * Runtime lifecycle/diagnostic events (flagged `diagnostic: true` at emission)
 * are tee'd here in addition to the existing JSONL/streamHub/session_actions
 * sinks. This sink is **opt-in**: it is a complete no-op unless
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and every emit path is best-effort so a
 * misconfigured or dead collector can never break the agent event loop.
 *
 * This deliberately builds the real OTLP pipeline now without changing the wire
 * protocol. HR8 will add the `ahp-otlp:` channel emission on top of this.
 */

/** OTLP resource `service.name` for Grackle server diagnostics. */
const SERVICE_NAME: string = "grackle-server";

/** Instrumentation scope name for emitted diagnostic log records. */
const LOGGER_SCOPE_NAME: string = "grackle-core";

/** Module-level provider, created by {@link initOtlpLogs}. Undefined = sink disabled. */
let loggerProvider: LoggerProvider | undefined;

/** Cached logger from the active provider, used by {@link emitDiagnostic}. */
let diagnosticLogger: Logger | undefined;

/**
 * Initialize the additive OTLP logs sink.
 *
 * Reads `OTEL_EXPORTER_OTLP_ENDPOINT`; when unset this is a no-op and returns
 * `undefined` (the common case — diagnostics still flow to all existing sinks).
 * When set, wires a {@link LoggerProvider} with a batching OTLP-HTTP exporter.
 * Never throws: a failed initialization disables the sink rather than breaking
 * server startup.
 *
 * @returns The created provider, or `undefined` when the sink is disabled.
 */
export function initOtlpLogs(): LoggerProvider | undefined {
  // Honor the logs-specific endpoint first, then the general one, matching the
  // OTLP exporter's own precedence so any standard OTel env-var combination
  // enables the sink (not just the general var).
  const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.debug("OTLP logs sink disabled (OTEL_EXPORTER_OTLP_LOGS_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT unset)");
    return undefined;
  }
  try {
    // OTLPLogExporter reads the same OTEL_EXPORTER_OTLP[_LOGS]_ENDPOINT env vars
    // for its URL, so the effective endpoint above is honored automatically.
    const exporter = new OTLPLogExporter();
    loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
      processors: [new BatchLogRecordProcessor(exporter)],
    });
    diagnosticLogger = loggerProvider.getLogger(LOGGER_SCOPE_NAME);
    logger.info({ endpoint }, "OTLP logs sink enabled for runtime diagnostics");
    return loggerProvider;
  } catch (err) {
    logger.warn({ err }, "Failed to initialize OTLP logs sink; diagnostics will not be exported");
    loggerProvider = undefined;
    diagnosticLogger = undefined;
    return undefined;
  }
}

/**
 * Emit a runtime diagnostic event as an OTLP log record.
 *
 * No-op when the sink is disabled (no provider) and best-effort otherwise — any
 * error is swallowed so the event-processor loop is never disrupted. Callers
 * should gate on `event.diagnostic` before calling.
 *
 * @param event - The diagnostic {@link grackle.SessionEvent} to export.
 */
export function emitDiagnostic(event: grackle.SessionEvent): void {
  if (!diagnosticLogger) {
    return;
  }
  try {
    const traceId = getTraceId();
    const timestamp = Date.parse(event.timestamp);
    diagnosticLogger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: event.content,
      timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
      attributes: {
        "session.id": event.sessionId,
        "grackle.event_type": eventTypeToString(event.type),
        ...(traceId ? { "trace.id": traceId } : {}),
      },
    });
  } catch (err) {
    logger.debug({ err }, "Failed to emit diagnostic OTLP log record");
  }
}

/**
 * Flush and shut down the OTLP logs sink during graceful server shutdown.
 *
 * No-op when the sink was never initialized. The flush is bounded by
 * {@link timeoutMs} so a dead collector cannot hang shutdown.
 *
 * @param timeoutMs - Maximum time to wait for the flush + shutdown to complete.
 */
export async function shutdownOtlpLogs(timeoutMs: number): Promise<void> {
  const provider = loggerProvider;
  if (!provider) {
    return;
  }
  loggerProvider = undefined;
  diagnosticLogger = undefined;
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs).unref();
  });
  try {
    await Promise.race([provider.forceFlush().then(() => provider.shutdown()), deadline]);
  } catch (err) {
    logger.debug({ err }, "Error flushing OTLP logs sink during shutdown");
  }
}
