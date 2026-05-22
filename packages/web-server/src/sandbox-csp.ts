/**
 * Content-Security-Policy builder for the MCP Apps sandbox origin.
 *
 * Ported from the T1 Storybook sidecar (`@grackle-ai/web-components`
 * `mcp-app-sandbox/serve.mjs`) — kept in TS here so the production sandbox server
 * can unit-test it. The CSP locks down the inner widget: `script-src 'self' blob:`
 * (no `unsafe-inline`/`unsafe-eval`), widened only by the per-resource domain
 * allowlists supplied via the `?csp=` query param (`McpUiResourceCsp`).
 */

/** Subset of MCP Apps `McpUiResourceCsp` honored by the sandbox CSP. */
export interface SandboxCsp {
  resourceDomains?: unknown;
  connectDomains?: unknown;
  frameDomains?: unknown;
  baseUriDomains?: unknown;
}

/** Reject domain entries containing characters that could break out of a CSP directive. */
function sanitizeCspDomains(domains: unknown): string[] {
  if (!Array.isArray(domains)) {
    return [];
  }
  return (domains as unknown[]).filter(
    (d): d is string => typeof d === "string" && !/[;\r\n'" ]/.test(d),
  );
}

/**
 * Build the `Content-Security-Policy` header value from an optional
 * `McpUiResourceCsp`. Unknown/empty input yields the locked-down default.
 */
export function buildCspHeader(csp: SandboxCsp | undefined): string {
  const resourceDomains: string = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains: string = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains: string = sanitizeCspDomains(csp?.frameDomains).join(" ");
  const baseUriDomains: string = sanitizeCspDomains(csp?.baseUriDomains).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' blob: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ].join("; ");
}
