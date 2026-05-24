/**
 * Content-Security-Policy builder for the MCP Apps sandbox origin.
 *
 * Ported from the T1 Storybook sidecar (`@grackle-ai/web-components`
 * `mcp-app-sandbox/serve.mjs`) — kept in TS here so the production sandbox server
 * can unit-test it. The CSP locks down the inner widget: `script-src 'self' blob:`
 * by default, widened only by the per-resource domain allowlists supplied via the
 * `?csp=` query param (`McpUiResourceCsp`) and two explicit opt-in flags —
 * `allowInlineScripts` (`'unsafe-inline'`, agent-authored HTML widgets, #1239) and
 * `allowUnsafeEval` (`'unsafe-eval'`, the Grackle React runtime, #1268). Both are
 * safe only because the sandbox is a separate origin (no `window.top`) with a
 * restricted `connect-src`, so code runs isolated with no exfil path.
 */

/** Subset of MCP Apps `McpUiResourceCsp` honored by the sandbox CSP. */
export interface SandboxCsp {
  resourceDomains?: unknown;
  connectDomains?: unknown;
  frameDomains?: unknown;
  baseUriDomains?: unknown;
  /**
   * Allow inline `<script>` in the sandbox (`script-src 'unsafe-inline'`). Set for
   * agent-authored widgets (#1239), which have no served JS origin. Safe because
   * the sandbox is a separate origin (no `window.top`) with a restricted
   * `connect-src`; inline scripts run only within the isolated widget origin.
   */
  allowInlineScripts?: unknown;
  /**
   * Allow `eval`/`new Function` in the sandbox (`script-src 'unsafe-eval'`). Set for
   * the Grackle React runtime (#1268), which transpiles + executes agent JSX via
   * react-live (`new Function`). Safe for the same reason as `allowInlineScripts`:
   * the sandbox is a separate origin with a restricted `connect-src` (no exfil).
   */
  allowUnsafeEval?: unknown;
}

/**
 * Keep only entries that are bare http(s) origins (e.g. `http://127.0.0.1:7435`).
 *
 * The `?csp=` param is host-supplied and may be attacker-influenced, so this is
 * a strict allowlist: it rejects anything that is not a concrete http(s) origin
 * — `*`, scheme-only sources (`data:`/`blob:`), wildcards, paths/queries, and
 * any entry with characters that could break out of a CSP directive. This keeps
 * it a true per-resource *domain* allowlist that cannot widen the widget's
 * script/connect surface beyond explicit origins.
 */
function sanitizeCspDomains(domains: unknown): string[] {
  if (!Array.isArray(domains)) {
    return [];
  }
  return (domains as unknown[]).filter((d): d is string => {
    if (typeof d !== "string" || /[;\r\n'"* ]/.test(d)) {
      return false;
    }
    try {
      const url = new URL(d);
      // Must be a bare origin (no path/query/fragment) over http(s).
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin === d;
    } catch {
      return false;
    }
  });
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
  const inlineScripts: string = csp?.allowInlineScripts === true ? " 'unsafe-inline'" : "";
  const unsafeEval: string = csp?.allowUnsafeEval === true ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self'${inlineScripts}${unsafeEval} blob: ${resourceDomains}`.trim(),
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
