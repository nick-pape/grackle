import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { Logger } from "pino";
import type { TlsConfig } from "./config.js";

/**
 * Loaded native-TLS material ready to hand to `http2.createSecureServer`.
 *
 * The `cert` buffer already includes any intermediate-chain content from
 * `GRACKLE_TLS_CA` appended via {@link loadSecureContext}, so callers do not
 * need to set a separate `ca` field on the secure-server options.
 */
export interface SecureContext {
  /** PEM cert (possibly concatenated with CA chain). */
  cert: Buffer;
  /** PEM private key. */
  key: Buffer;
}

/**
 * Read cert/key (and optional intermediate-CA bundle) from disk and produce a
 * {@link SecureContext} suitable for `http2.createSecureServer`.
 *
 * The intermediate-CA bundle is appended to the leaf certificate so the full
 * chain is served to clients. This is the common deployment pattern (internal
 * PKI / Let's Encrypt with intermediates); operators who need mTLS client
 * verification can re-purpose the variable later behind a feature flag.
 *
 * The cert's subject + expiry are logged at info level so the operator sees
 * which material is in use without parsing the PEM by hand.
 */
export function loadSecureContext(tls: TlsConfig, logger: Logger): SecureContext {
  let cert: Buffer;
  try {
    cert = readFileSync(tls.certPath);
  } catch (err) {
    throw new Error(`Failed to read GRACKLE_TLS_CERT at "${tls.certPath}": ${describe(err)}`);
  }

  let key: Buffer;
  try {
    key = readFileSync(tls.keyPath);
  } catch (err) {
    throw new Error(`Failed to read GRACKLE_TLS_KEY at "${tls.keyPath}": ${describe(err)}`);
  }

  if (tls.caPath) {
    let chain: Buffer;
    try {
      chain = readFileSync(tls.caPath);
    } catch (err) {
      throw new Error(`Failed to read GRACKLE_TLS_CA at "${tls.caPath}": ${describe(err)}`);
    }
    // Ensure a newline separator so two PEM blocks don't run together.
    const sep =
      cert.length > 0 && cert[cert.length - 1] !== 0x0a ? Buffer.from("\n") : Buffer.alloc(0);
    cert = Buffer.concat([cert, sep, chain]);
  }

  // Best-effort: parse the leaf cert for observability. Never let a malformed
  // cert here mask the real downstream TLS error.
  try {
    const x509 = new X509Certificate(cert);
    logger.info(
      {
        subject: x509.subject,
        validFrom: x509.validFrom,
        validTo: x509.validTo,
        certPath: tls.certPath,
        keyPath: tls.keyPath,
        caPath: tls.caPath,
      },
      "TLS enabled — terminating TLS in-process on all listeners",
    );
  } catch (err) {
    logger.warn(
      { err, certPath: tls.certPath },
      "TLS enabled but could not parse leaf certificate for diagnostics",
    );
  }

  return { cert, key };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
