import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import pino from "pino";
import { loadSecureContext } from "./tls.js";
import type { TlsConfig } from "./config.js";

const FIXTURE_DIR: string = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const CERT_PATH: string = join(FIXTURE_DIR, "tls-test-cert.pem");
const KEY_PATH: string = join(FIXTURE_DIR, "tls-test-key.pem");
const CA_PATH: string = join(FIXTURE_DIR, "tls-test-ca.pem");

/** Silent logger so unit tests don't pollute the run output. */
function silentLogger(): ReturnType<typeof pino> {
  return pino({ level: "silent" });
}

describe("loadSecureContext (#1373)", () => {
  it("loads cert+key buffers from disk", () => {
    const tls: TlsConfig = { certPath: CERT_PATH, keyPath: KEY_PATH };
    const ctx = loadSecureContext(tls, silentLogger());
    expect(ctx.cert.toString("utf8")).toContain("-----BEGIN CERTIFICATE-----");
    expect(ctx.key.toString("utf8")).toMatch(/-----BEGIN (RSA )?PRIVATE KEY-----/);
  });

  it("appends the CA chain to cert when chainPath is set", () => {
    const tls: TlsConfig = { certPath: CERT_PATH, keyPath: KEY_PATH, chainPath: CA_PATH };
    const ctx = loadSecureContext(tls, silentLogger());
    const certText = ctx.cert.toString("utf8");
    // Two BEGIN CERTIFICATE blocks — leaf + chain.
    const matches = certText.match(/-----BEGIN CERTIFICATE-----/g);
    expect(matches?.length).toBe(2);
    // Chain content is present verbatim after the leaf.
    expect(certText).toContain(readFileSync(CA_PATH, "utf8"));
  });

  it("logs the cert subject + validity window at startup", () => {
    const logger = silentLogger();
    const infoSpy = vi.spyOn(logger, "info");
    loadSecureContext({ certPath: CERT_PATH, keyPath: KEY_PATH }, logger);
    expect(infoSpy).toHaveBeenCalled();
    const firstCall = infoSpy.mock.calls[0]!;
    const meta = firstCall[0] as { subject?: string; validFrom?: string; validTo?: string };
    expect(meta.subject).toContain("CN=localhost");
    expect(meta.validFrom).toBeTruthy();
    expect(meta.validTo).toBeTruthy();
  });

  it("wraps cert-read errors with a clear message", () => {
    const tls: TlsConfig = { certPath: join(FIXTURE_DIR, "missing.pem"), keyPath: KEY_PATH };
    expect(() => loadSecureContext(tls, silentLogger())).toThrow(/Failed to read GRACKLE_TLS_CERT/);
  });

  it("wraps key-read errors with a clear message", () => {
    const tls: TlsConfig = { certPath: CERT_PATH, keyPath: join(FIXTURE_DIR, "missing.pem") };
    expect(() => loadSecureContext(tls, silentLogger())).toThrow(/Failed to read GRACKLE_TLS_KEY/);
  });
});
