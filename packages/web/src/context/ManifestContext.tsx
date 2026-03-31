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
const ALL_KNOWN_PLUGINS: readonly string[] = ["core", "orchestration"];

/** Shape of the manifest returned by `GET /api/manifest`. */
interface ManifestResponse {
  plugins: Array<{ name: string }>;
}

/** Value provided by ManifestContext. */
export interface ManifestValue {
  /** Names of active plugins, in server load order. Empty while loading. */
  pluginNames: string[];
  /** True while the manifest fetch is in flight. */
  loading: boolean;
  /** Set if the fetch failed (pluginNames will be the fail-open fallback). */
  error: Error | undefined;
}

const ManifestContext: Context<ManifestValue> = createContext<ManifestValue>({
  pluginNames: [...ALL_KNOWN_PLUGINS],
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
    <ManifestContext.Provider value={{ pluginNames, loading, error }}>
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
