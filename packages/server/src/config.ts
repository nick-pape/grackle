import { accessSync, constants as fsConstants } from "node:fs";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_PORT,
  DEFAULT_MCP_PORT,
  DEFAULT_POWERLINE_PORT,
  DEFAULT_SANDBOX_PORT,
} from "@grackle-ai/common";
import { parsePublicOrigin } from "@grackle-ai/auth";

/**
 * Native-TLS configuration resolved from environment variables.
 *
 * When present, every browser- and client-facing Grackle listener (web,
 * sandbox, MCP, gRPC) terminates TLS in-process. The web/sandbox/MCP
 * listeners use `http2.createSecureServer({ allowHTTP1: true })` so HTTP/1.1
 * clients still negotiate via ALPN; the gRPC listener is intentionally
 * h2-only (`createSecureServer` without `allowHTTP1`) because gRPC clients
 * always speak h2. Used by deployments that expose the server on the network
 * without a fronting TLS proxy (#1373).
 */
export interface TlsConfig {
  /** Filesystem path to the PEM-encoded server certificate (`GRACKLE_TLS_CERT`). */
  certPath: string;
  /** Filesystem path to the PEM-encoded private key (`GRACKLE_TLS_KEY`). */
  keyPath: string;
  /**
   * Optional filesystem path to an intermediate-CA PEM bundle
   * (`GRACKLE_TLS_CHAIN`). When set, the contents are appended to the server
   * certificate at load time so the full chain is served to clients. This is
   * **server identity** only — for client-cert verification (mTLS) see #1393
   * (`GRACKLE_TLS_CLIENT_CA`, future).
   */
  chainPath?: string;
}

/** Validated server configuration resolved from environment variables. */
export interface ServerConfig {
  /** gRPC server port (GRACKLE_PORT). */
  grpcPort: number;
  /** Web UI + WebSocket port (GRACKLE_WEB_PORT). */
  webPort: number;
  /** MCP server port (GRACKLE_MCP_PORT). */
  mcpPort: number;
  /**
   * Canonical browser-facing origin (GRACKLE_PUBLIC_URL), e.g.
   * `https://grackle.home`. When set, it is the source of truth for the
   * browser-facing scheme + host behind a TLS-terminating reverse proxy: it
   * drives the OAuth authorization-server metadata scheme/host, the session
   * cookie `Secure` flag, HSTS emission, the pairing/QR URL, the channel
   * ingress base URL, and the MCP authorization-server URL. When unset, every
   * consumer falls back to today's loopback-http behavior. Must be an http(s)
   * origin with no path/query/fragment.
   */
  publicUrl?: string;
  /**
   * Explicit browser-facing MCP origin (GRACKLE_MCP_ORIGIN), e.g.
   * `https://mcp.example.com`. Used as the trusted asset/CSP origin for
   * broker-captured MCP Apps widgets (so it never depends on the request `Host`).
   * When unset, the broker derives it from the bind host + `mcpPort`.
   */
  mcpOrigin?: string;
  /** MCP Apps widget sandbox port (GRACKLE_SANDBOX_PORT). */
  sandboxPort: number;
  /**
   * Explicit browser-facing sandbox origin (GRACKLE_SANDBOX_ORIGIN), e.g.
   * `https://sandbox.example.com`. Set this when the SPA is served behind a
   * reverse proxy / TLS, where the scheme + port the browser must use for the
   * sandbox cannot be inferred from the page's own origin + `sandboxPort`.
   * When unset, the SPA derives the origin from `window.location` + `sandboxPort`.
   */
  sandboxOrigin?: string;
  /** PowerLine server port (GRACKLE_POWERLINE_PORT). */
  powerlinePort: number;
  /** Bind address for all servers (GRACKLE_HOST). */
  host: string;
  /** Skip auto-starting the local PowerLine process (GRACKLE_SKIP_LOCAL_POWERLINE=1). */
  skipLocalPowerline: boolean;
  /** Skip auto-starting the root task when an environment connects (GRACKLE_SKIP_ROOT_AUTOSTART=1). */
  skipRootAutostart: boolean;
  /** Override agent working directory (GRACKLE_WORKING_DIRECTORY). */
  workingDirectory?: string;
  /** Worktree base path (GRACKLE_WORKTREE_BASE). */
  worktreeBase?: string;
  /** Docker host for host mapping (GRACKLE_DOCKER_HOST). */
  dockerHost?: string;
  /**
   * Native-TLS configuration (`GRACKLE_TLS_CERT` + `GRACKLE_TLS_KEY`, optional
   * `GRACKLE_TLS_CHAIN`). When present, the server terminates TLS in-process on
   * every listener. When unset, listeners serve cleartext (current behavior).
   */
  tls?: TlsConfig;
  /**
   * Deliberate opt-in (`GRACKLE_ALLOW_INSECURE=1`) to run a non-loopback bind
   * without TLS. Required by the startup gate (#1374) on any host that isn't
   * loopback (`127.0.0.1` / `::1` / `localhost`) when neither native TLS nor an
   * `https://` public URL is configured. Remediates GHSA-wcpf-6gwv-47c8 by
   * making cleartext-on-the-network a conscious choice instead of the silent
   * default. The Docker image bakes this in (`ENV GRACKLE_ALLOW_INSECURE=1`)
   * for `docker run` ergonomics — clear it when adding TLS.
   */
  allowInsecure: boolean;
}

/**
 * Parse and validate a port number from an environment variable.
 * Returns the default if the variable is not set.
 * Throws if the value is not a valid port (integer 1-65535).
 */
function parsePort(envName: string, defaultValue: number): number {
  const raw = process.env[envName];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid port for ${envName}: "${raw}". Must be an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

/** Parse a boolean flag from an environment variable ("1" = true, anything else = false). */
function parseFlag(envName: string): boolean {
  return process.env[envName] === "1";
}

/**
 * Parse the native-TLS config from env vars. Returns `undefined` when neither
 * cert nor key is set (the cleartext default). Throws when only one is set, or
 * when any referenced file is missing/unreadable, so the operator sees a clear
 * startup error rather than a confusing handshake failure later.
 */
function parseTlsConfig(): TlsConfig | undefined {
  const certPath = process.env.GRACKLE_TLS_CERT;
  const keyPath = process.env.GRACKLE_TLS_KEY;
  const chainPath = process.env.GRACKLE_TLS_CHAIN;

  if (!certPath && !keyPath) {
    if (chainPath) {
      throw new Error(
        "GRACKLE_TLS_CHAIN is set but GRACKLE_TLS_CERT and GRACKLE_TLS_KEY are not. " +
          "Set both cert and key (or unset chain).",
      );
    }
    return undefined;
  }
  if (!certPath || !keyPath) {
    throw new Error(
      "GRACKLE_TLS_CERT and GRACKLE_TLS_KEY must both be set, or neither. " +
        `Got cert=${certPath ? "set" : "unset"}, key=${keyPath ? "set" : "unset"}.`,
    );
  }

  const checkReadable = (envName: string, path: string): void => {
    try {
      accessSync(path, fsConstants.R_OK);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${envName} path "${path}" is not readable: ${message}`);
    }
  };
  checkReadable("GRACKLE_TLS_CERT", certPath);
  checkReadable("GRACKLE_TLS_KEY", keyPath);
  if (chainPath) {
    checkReadable("GRACKLE_TLS_CHAIN", chainPath);
  }

  return {
    certPath,
    keyPath,
    ...(chainPath ? { chainPath } : {}),
  };
}

/**
 * Parse and validate the canonical public origin from an environment variable.
 *
 * Returns `undefined` when unset or blank. When set, delegates to the shared
 * {@link parsePublicOrigin} validator: the value must be a bare absolute http(s)
 * origin (no path/query/fragment/userinfo) — sub-path reverse-proxy deployments
 * (e.g. `https://example.com/grackle`) are not supported because the OAuth and
 * pairing routes append absolute paths. Throws a clear error on an invalid value
 * so the server fails fast at startup. The returned value is the normalized
 * origin (no trailing slash).
 */
function parsePublicUrl(envName: string): string | undefined {
  const raw = process.env[envName];
  if (!raw?.trim()) {
    return undefined;
  }
  return parsePublicOrigin(raw, envName).origin;
}

/**
 * Whether `GRACKLE_HOST` resolves to a loopback bind. Treats `localhost` as
 * loopback because the DNS resolver always maps it to `127.0.0.1` / `::1`;
 * operators who write `GRACKLE_HOST=localhost` mean "loopback only", which is
 * what we want for the gate's pass-through case. Duplicates the predicate in
 * `packages/mcp/src/mcp-server.ts:isLoopbackHostname` — a follow-up can hoist
 * both into `@grackle-ai/auth/public-origin.ts` so there's one source of truth.
 */
function isLoopbackBind(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Startup gate for advisory GHSA-wcpf-6gwv-47c8 (#1374). A non-loopback bind
 * (anything that puts the API key + session cookie on a wire other operators
 * can sniff) must be backed by TLS — either native (`GRACKLE_TLS_CERT/KEY`,
 * #1373) or a fronting proxy that terminates TLS upstream (`GRACKLE_PUBLIC_URL`
 * with an `https://` scheme, #1371). Operators who deliberately want cleartext
 * on the network (testing, an internal trust boundary, an http-only proxy)
 * set `GRACKLE_ALLOW_INSECURE=1` so the choice is conscious and auditable.
 *
 * Throws a fail-fast error naming every satisfier so the message is enough to
 * fix the deployment without a doc round-trip.
 */
function validateNetworkExposure(args: {
  host: string;
  hasTls: boolean;
  publicUrl: string | undefined;
  allowInsecure: boolean;
}): void {
  const { host, hasTls, publicUrl, allowInsecure } = args;
  if (isLoopbackBind(host)) {
    return;
  }
  if (hasTls) {
    return;
  }
  if (publicUrl?.startsWith("https://")) {
    return;
  }
  if (allowInsecure) {
    return;
  }
  throw new Error(
    `Insecure network exposure: GRACKLE_HOST="${host}" is not loopback ` +
      "and no TLS is configured. Pick one:\n" +
      "  1. Set GRACKLE_TLS_CERT + GRACKLE_TLS_KEY for native TLS, OR\n" +
      "  2. Set GRACKLE_PUBLIC_URL=https://<host> when fronting with a TLS proxy, OR\n" +
      "  3. Set GRACKLE_ALLOW_INSECURE=1 to deliberately accept cleartext on the network.\n" +
      "Without one of these the API key and session cookie would traverse the network " +
      "in cleartext (advisory GHSA-wcpf-6gwv-47c8).",
  );
}

/**
 * Resolve and validate all server configuration from environment variables.
 * Throws on invalid values so the server fails fast at startup with a clear error.
 */
export function resolveServerConfig(): ServerConfig {
  const tls = parseTlsConfig();
  const host = process.env.GRACKLE_HOST || "127.0.0.1";
  const publicUrl = parsePublicUrl("GRACKLE_PUBLIC_URL");
  const allowInsecure = parseFlag("GRACKLE_ALLOW_INSECURE");
  // Run the network-exposure gate (#1374) before we finish building the config
  // so the throw fires before any caller can spin up a listener with insecure
  // defaults. Loopback binds are always allowed (today's casual local default).
  validateNetworkExposure({ host, hasTls: !!tls, publicUrl, allowInsecure });
  return Object.freeze({
    grpcPort: parsePort("GRACKLE_PORT", DEFAULT_SERVER_PORT),
    webPort: parsePort("GRACKLE_WEB_PORT", DEFAULT_WEB_PORT),
    mcpPort: parsePort("GRACKLE_MCP_PORT", DEFAULT_MCP_PORT),
    ...(publicUrl ? { publicUrl } : {}),
    ...(process.env.GRACKLE_MCP_ORIGIN ? { mcpOrigin: process.env.GRACKLE_MCP_ORIGIN } : {}),
    sandboxPort: parsePort("GRACKLE_SANDBOX_PORT", DEFAULT_SANDBOX_PORT),
    ...(process.env.GRACKLE_SANDBOX_ORIGIN
      ? { sandboxOrigin: process.env.GRACKLE_SANDBOX_ORIGIN }
      : {}),
    powerlinePort: parsePort("GRACKLE_POWERLINE_PORT", DEFAULT_POWERLINE_PORT),
    host,
    skipLocalPowerline: parseFlag("GRACKLE_SKIP_LOCAL_POWERLINE"),
    skipRootAutostart: parseFlag("GRACKLE_SKIP_ROOT_AUTOSTART"),
    workingDirectory: process.env.GRACKLE_WORKING_DIRECTORY || undefined,
    worktreeBase: process.env.GRACKLE_WORKTREE_BASE || undefined,
    dockerHost: process.env.GRACKLE_DOCKER_HOST || undefined,
    ...(tls ? { tls } : {}),
    allowInsecure,
  });
}
