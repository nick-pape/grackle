import type { ServerResponse } from "node:http";

/**
 * Base Content Security Policy directives for the web handler.
 *
 * Covers the React SPA (served from 'self') and server-rendered pages
 * (pairing/authorize) which use inline styles.
 *
 * Note: `form-action` is intentionally omitted here and appended dynamically
 * by {@link setSecurityHeaders} using the request's Host header, because
 * Chromium does not reliably match `'self'` for form submissions on
 * non-standard ports.
 */
const BASE_CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
];

/**
 * Full CSP string with `form-action 'self'` — used by tests and as a
 * backwards-compatible export.
 */
export const WEB_CONTENT_SECURITY_POLICY: string = [
  ...BASE_CSP_DIRECTIVES,
  "frame-src 'self'",
  "form-action 'self'",
].join("; ");

/**
 * `Strict-Transport-Security` value emitted when the connection is served over
 * HTTPS. One year, without `includeSubDomains` — the latter could force HTTPS
 * onto sibling subdomains of a shared apex (e.g. `grackle.home`) and is hard to
 * roll back, so it is intentionally omitted.
 */
const HSTS_MAX_AGE_SECONDS: number = 31_536_000;

/** Optional flags controlling scheme-dependent security headers. */
export interface SecurityHeaderOptions {
  /**
   * When true, emit a `Strict-Transport-Security` header. Set this only when the
   * browser-facing scheme is HTTPS (e.g. `GRACKLE_PUBLIC_URL` is an https
   * origin), never for a plain-http origin.
   */
  hsts?: boolean;
  /**
   * Explicit browser-facing MCP Apps sandbox origin (`GRACKLE_SANDBOX_ORIGIN`),
   * added to the CSP `frame-src` directive. Behind a reverse proxy the sandbox
   * iframe may live on a *different host* than the web app, which the
   * request-host wildcard does not cover; without this the browser would block
   * the widget iframe. Invalid values are ignored.
   */
  sandboxOrigin?: string;
}

/**
 * Set defense-in-depth security headers on every web response.
 *
 * Called at the top of `createWebHandler`'s returned function so that all
 * response paths (static files, HTML pages, JSON APIs, redirects) are covered
 * without modifying each `writeHead` call individually.
 *
 * @param res - The HTTP response to set headers on.
 * @param requestHost - The `Host` header from the incoming request. When
 *   provided, the CSP `form-action` directive explicitly includes the
 *   request origin to work around a Chromium bug where `'self'` does not
 *   match form submissions on non-standard ports.
 * @param options - Optional scheme-dependent headers (e.g. {@link SecurityHeaderOptions.hsts}).
 */
export function setSecurityHeaders(
  res: ServerResponse,
  requestHost?: string,
  options?: SecurityHeaderOptions,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (options?.hsts) {
    res.setHeader("Strict-Transport-Security", `max-age=${HSTS_MAX_AGE_SECONDS}`);
  }
  // Chromium does not reliably match 'self' or explicit origin+port for
  // form-action on non-standard ports. Use the request hostname with a
  // wildcard port so the form POST is allowed regardless of port.
  // Validate via URL constructor to prevent CSP header injection (e.g. Host
  // containing ';' could splice directives).
  let formAction = "form-action 'self'";
  // The chat embeds the MCP Apps widget sandbox in an iframe. The sandbox runs
  // on the same hostname but a different port (GRACKLE_SANDBOX_PORT), and
  // Chromium does not reliably match 'self' across ports — so allow the request
  // hostname on any port (same workaround as form-action). The framed sandbox
  // is itself origin-isolated with its own locked-down CSP, so this only widens
  // which origins the app may *embed*, not what runs inside them.
  const frameSrcSources: string[] = ["'self'"];
  if (requestHost) {
    try {
      const parsed = new URL(`http://${requestHost}`);
      const hostname = parsed.hostname;
      formAction = `form-action 'self' http://${hostname}:* https://${hostname}:*`;
      frameSrcSources.push(`http://${hostname}:*`, `https://${hostname}:*`);
    } catch {
      // Malformed Host header — fall back to 'self' only
    }
  }
  // Allow the explicitly-configured sandbox origin (which may be a different host
  // behind a reverse proxy, uncovered by the request-host wildcard above). Parse
  // via URL to normalize and prevent CSP injection through a malformed value.
  if (options?.sandboxOrigin) {
    try {
      frameSrcSources.push(new URL(options.sandboxOrigin).origin);
    } catch {
      // Invalid sandbox origin — ignore.
    }
  }
  const frameSrc = `frame-src ${frameSrcSources.join(" ")}`;
  const csp = [...BASE_CSP_DIRECTIVES, frameSrc, formAction].join("; ");
  res.setHeader("Content-Security-Policy", csp);
}
