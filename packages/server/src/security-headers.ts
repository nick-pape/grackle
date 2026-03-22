import type { ServerResponse } from "node:http";

/**
 * Content Security Policy for the web handler.
 *
 * Covers the React SPA (served from 'self') and server-rendered pages
 * (pairing/authorize) which use inline styles.
 */
export const WEB_CONTENT_SECURITY_POLICY: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

/**
 * Set defense-in-depth security headers on every web response.
 *
 * Called at the top of `createWebHandler`'s returned function so that all
 * response paths (static files, HTML pages, JSON APIs, redirects) are covered
 * without modifying each `writeHead` call individually.
 */
export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", WEB_CONTENT_SECURITY_POLICY);
}
