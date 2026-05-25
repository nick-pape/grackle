import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

// ── Capture spies shared between the OTel mock and the assertions ──
const h = vi.hoisted(() => ({
  emitSpy: vi.fn(),
  getLoggerSpy: vi.fn(),
  forceFlushSpy: vi.fn(() => Promise.resolve()),
  shutdownSpy: vi.fn(() => Promise.resolve()),
}));

// Mock the OpenTelemetry SDK so tests never touch the network. The fake
// LoggerProvider hands back a logger whose emit() is the captured spy.
vi.mock("@opentelemetry/sdk-logs", () => {
  class LoggerProvider {
    public constructor(_options: unknown) {}
    public getLogger(): { emit: typeof h.emitSpy } {
      h.getLoggerSpy();
      return { emit: h.emitSpy };
    }
    public forceFlush(): Promise<void> {
      return h.forceFlushSpy();
    }
    public shutdown(): Promise<void> {
      return h.shutdownSpy();
    }
  }
  class BatchLogRecordProcessor {
    public constructor(_exporter: unknown) {}
  }
  return { LoggerProvider, BatchLogRecordProcessor };
});

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {},
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attrs: Record<string, unknown>) => attrs,
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));

vi.mock("@opentelemetry/api-logs", () => ({
  SeverityNumber: { INFO: 9 },
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./trace-context.js", () => ({
  getTraceId: vi.fn(() => "trace-abc"),
}));

const ORIGINAL_ENDPOINT: string | undefined = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

/** Build a diagnostic SessionEvent for emit assertions. */
function makeDiagnostic(content: string): grackle.SessionEvent {
  return create(grackle.SessionEventSchema, {
    sessionId: "sess-1",
    type: grackle.EventType.SYSTEM,
    timestamp: "2026-01-01T00:00:00.000Z",
    content,
    diagnostic: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_ENDPOINT === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ORIGINAL_ENDPOINT;
  }
});

describe("telemetry — sink disabled (no endpoint)", () => {
  it("initOtlpLogs returns undefined and emitDiagnostic is a no-op", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const t = await import("./telemetry.js");

    expect(t.initOtlpLogs()).toBeUndefined();
    t.emitDiagnostic(makeDiagnostic("Starting runtime..."));

    expect(h.getLoggerSpy).not.toHaveBeenCalled();
    expect(h.emitSpy).not.toHaveBeenCalled();
  });

  it("shutdownOtlpLogs is a no-op when never initialized", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const t = await import("./telemetry.js");

    await expect(t.shutdownOtlpLogs(1000)).resolves.toBeUndefined();
    expect(h.forceFlushSpy).not.toHaveBeenCalled();
  });
});

describe("telemetry — sink enabled (endpoint set)", () => {
  it("initOtlpLogs builds a provider and emitDiagnostic emits a log record with attributes", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const t = await import("./telemetry.js");

    expect(t.initOtlpLogs()).toBeDefined();
    t.emitDiagnostic(makeDiagnostic("Session initialized"));

    expect(h.emitSpy).toHaveBeenCalledTimes(1);
    const record = h.emitSpy.mock.calls[0][0] as {
      body: string;
      severityNumber: number;
      attributes: Record<string, unknown>;
    };
    expect(record.body).toBe("Session initialized");
    expect(record.severityNumber).toBe(9);
    expect(record.attributes["session.id"]).toBe("sess-1");
    expect(record.attributes["grackle.event_type"]).toBe("system");
    expect(record.attributes["trace.id"]).toBe("trace-abc");
  });

  it("shutdownOtlpLogs flushes then shuts down the provider", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const t = await import("./telemetry.js");
    t.initOtlpLogs();

    await t.shutdownOtlpLogs(1000);

    expect(h.forceFlushSpy).toHaveBeenCalledTimes(1);
    expect(h.shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it("emitDiagnostic swallows emit errors (best-effort, never throws)", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    h.emitSpy.mockImplementationOnce(() => {
      throw new Error("collector down");
    });
    const t = await import("./telemetry.js");
    t.initOtlpLogs();

    expect(() => t.emitDiagnostic(makeDiagnostic("boom"))).not.toThrow();
  });
});
