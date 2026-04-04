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
  "form-action 'self'",
].join("; ");

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
 */
export function setSecurityHeaders(res: ServerResponse, requestHost?: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Chromium does not reliably match 'self' or explicit origin+port for
  // form-action on non-standard ports. Use the request hostname with a
  // wildcard port so the form POST is allowed regardless of port.
  // Validate via URL constructor to prevent CSP header injection (e.g. Host
  // containing ';' could splice directives).
  let formAction = "form-action 'self'";
  if (requestHost) {
    try {
      const parsed = new URL(`http://${requestHost}`);
      const hostname = parsed.hostname;
      formAction = `form-action 'self' http://${hostname}:* https://${hostname}:*`;
    } catch {
      // Malformed Host header — fall back to 'self' only
    }
  }
  const csp = [...BASE_CSP_DIRECTIVES, formAction].join("; ");
  res.setHeader("Content-Security-Policy", csp);
}
