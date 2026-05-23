/**
 * ManifestContext — provides the list of active plugin names fetched from
 * `GET /api/manifest` on app load.
 *
 * The provider is the outermost wrapper in App.tsx so that all hooks
 * (including useGrackleSocket) can read the manifest via useManifest().
 *
 * @module
 */

import { createContext, useContext, useEffect, useState, type Context, type JSX, type ReactNode } from "react";

/** All plugin names known to the web client. Used as the fail-open fallback. */
const ALL_KNOWN_PLUGINS: readonly string[] = ["core", "orchestration", "scheduling"];

/** Shape of the manifest returned by `GET /api/manifest`. */
interface ManifestResponse {
  plugins: Array<{ name: string }>;
  sandboxPort?: number;
  sandboxOrigin?: string;
}

/** Value provided by ManifestContext. */
export interface ManifestValue {
  /** Names of active plugins, in server load order. Empty while loading. */
  pluginNames: string[];
  /** MCP Apps widget sandbox port (for deriving the sandbox origin). Undefined until loaded. */
  sandboxPort: number | undefined;
  /**
   * Explicit browser-facing sandbox origin (e.g. `https://sandbox.example.com`),
   * set server-side via GRACKLE_SANDBOX_ORIGIN for reverse-proxy / TLS
   * deployments. Takes precedence over `sandboxPort`. Undefined until loaded.
   */
  sandboxOrigin: string | undefined;
  /** True while the manifest fetch is in flight. */
  loading: boolean;
  /** Set if the fetch failed (pluginNames will be the fail-open fallback). */
  error: Error | undefined;
}

const ManifestContext: Context<ManifestValue> = createContext<ManifestValue>({
  pluginNames: [...ALL_KNOWN_PLUGINS],
  sandboxPort: undefined,
  sandboxOrigin: undefined,
  loading: false,
  error: undefined,
});

/**
 * Provides the plugin manifest to the component tree.
 *
 * Fetches `GET /api/manifest` once on mount. On failure, falls back to all
 * known plugins (fail open) so the app remains usable without a server.
 */
export function ManifestProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pluginNames, setPluginNames] = useState<string[]>([...ALL_KNOWN_PLUGINS]);
  const [sandboxPort, setSandboxPort] = useState<number | undefined>(undefined);
  const [sandboxOrigin, setSandboxOrigin] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/manifest")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Manifest fetch returned ${res.status}`);
        }
        return res.json() as Promise<ManifestResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setPluginNames(data.plugins.map((p) => p.name));
          setSandboxPort(data.sandboxPort);
          setSandboxOrigin(data.sandboxOrigin);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPluginNames([...ALL_KNOWN_PLUGINS]);
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <ManifestContext.Provider value={{ pluginNames, sandboxPort, sandboxOrigin, loading, error }}>
      {children}
    </ManifestContext.Provider>
  );
}

/**
 * Returns the current manifest value (plugin names, loading state, error).
 *
 * Must be used within a {@link ManifestProvider}.
 */
export function useManifest(): ManifestValue {
  return useContext(ManifestContext);
}

/**
 * Derive the MCP Apps sandbox `sandbox.html` URL.
 *
 * Prefers an explicit server-configured `sandboxOrigin` (GRACKLE_SANDBOX_ORIGIN)
 * for reverse-proxy / TLS deployments where the scheme + port cannot be inferred
 * from the page's own origin. Otherwise derives the origin from
 * `window.location` + `sandboxPort`. Returns `undefined` until the manifest
 * loads (or if neither is set). The sandbox is a DIFFERENT origin than the web
 * app, as the MCP Apps double-iframe spec requires.
 */
export function useSandboxProxyUrl(): string | undefined {
  const { sandboxPort, sandboxOrigin } = useManifest();
  if (typeof window === "undefined") {
    return undefined;
  }
  // Explicit origin wins (handles HTTPS-proxy / non-derivable scheme + port).
  if (sandboxOrigin !== undefined && sandboxOrigin !== "") {
    return new URL("/sandbox.html", sandboxOrigin).toString();
  }
  if (sandboxPort === undefined) {
    return undefined;
  }
  // Derive from the page origin + sandboxPort. Build via URL (not string
  // interpolation) so IPv6 hosts are bracketed correctly — `location.hostname`
  // returns `::1`, which would otherwise yield an invalid `http://::1:PORT/...`.
  const url = new URL(window.location.origin);
  url.port = String(sandboxPort);
  url.pathname = "/sandbox.html";
  return url.toString();
}
