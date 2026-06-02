/**
 * Domain hook for the live-docs v0 viewer (#1396).
 *
 * Manages the read-only document pane: which files are open as tabs, which tab
 * is active, and per-tab change badges. Two producers open a tab — the agent's
 * `show_file` MCP tool (via the `document.show` domain event) and human clicks
 * on filepaths in chat — both through {@link UseDocumentsResult.openDocument}.
 *
 * Tabs are client UI state, not chat content: they do NOT rehydrate on reload
 * (the open set is in-memory). Each open tab is one resource subscription over
 * the AHP bridge (#1395) — `watchResource` on open, `unwatchResource` on close;
 * the bridge's own `useResources` hook re-reads on change, so the active tab
 * refreshes live. We additionally badge *inactive* tabs whose file changed.
 *
 * @module
 */

import { useCallback, useRef, useState, useMemo } from "react";
import type {
  DocumentTab,
  GrackleEvent,
  UseDocumentsResult,
  UseResourcesResult,
} from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";

/** The subset of the resource bridge the document pane drives. */
type ResourceBridge = Pick<
  UseResourcesResult,
  "readResource" | "watchResource" | "unwatchResource"
>;

/** Composite tab id for an environment + file URI. */
function tabIdFor(environmentId: string, uri: string): string {
  return `${environmentId} ${uri}`;
}

/** Derive a display label (basename) from a `file://` URI. */
function titleFromUri(uri: string): string {
  let path: string = uri;
  try {
    path = new URL(uri).pathname;
  } catch {
    // Not a URL — fall back to the raw string.
  }
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return uri;
  }
  const last = segments[segments.length - 1];
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Hook managing the live-document pane. Accepts the resource-bridge actions from
 * {@link useGrackleSocket} (rather than re-instantiating the gRPC client) so the
 * pane shares the bridge's content cache and watch routing.
 *
 * @param bridge - The resource bridge's read/watch/unwatch actions.
 * @returns Tab state, pane actions, and the domain hook.
 */
export function useDocuments(bridge: ResourceBridge): UseDocumentsResult {
  const { readResource, watchResource, unwatchResource } = bridge;

  const [tabs, setTabs] = useState<DocumentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);
  const [unseenTabIds, setUnseenTabIds] = useState<string[]>([]);

  // Refs mirror state for synchronous, stale-closure-free reads inside callbacks.
  const tabsRef = useRef<DocumentTab[]>([]);
  const activeRef = useRef<string | undefined>(undefined);
  // Active watch id per tab, so close can release the server-side watch.
  const watchIdsRef = useRef<Map<string, string>>(new Map());

  const markActive = useCallback((id: string | undefined): void => {
    activeRef.current = id;
    setActiveTabId(id);
    if (id !== undefined) {
      setUnseenTabIds((prev) => prev.filter((x) => x !== id));
    }
  }, []);

  const openDocument = useCallback(
    (args: { environmentId: string; uri: string }, options?: { focus?: boolean }): void => {
      const { environmentId, uri } = args;
      const id = tabIdFor(environmentId, uri);
      const focus = options?.focus ?? false;
      const exists = tabsRef.current.some((t) => t.id === id);

      if (!exists) {
        const tab: DocumentTab = { id, environmentId, uri, title: titleFromUri(uri) };
        tabsRef.current = [...tabsRef.current, tab];
        setTabs(tabsRef.current);
        // Start a watch (live refresh) and an initial read (first paint).
        watchResource(environmentId, uri)
          .then((watchId) => watchIdsRef.current.set(id, watchId))
          .catch(() => {});
        readResource(environmentId, uri).catch(() => {});
      }

      if (focus || activeRef.current === undefined) {
        // First tab, or an explicit focus request: activate it.
        markActive(id);
      } else if (activeRef.current !== id) {
        // Opened/re-shown in the background — badge it, don't steal focus.
        setUnseenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    },
    [readResource, watchResource, markActive],
  );

  const setActiveTab = useCallback(
    (id: string): void => {
      markActive(id);
    },
    [markActive],
  );

  const closeTab = useCallback(
    (id: string): void => {
      const watchId = watchIdsRef.current.get(id);
      if (watchId !== undefined) {
        unwatchResource(watchId).catch(() => {});
        watchIdsRef.current.delete(id);
      }
      tabsRef.current = tabsRef.current.filter((t) => t.id !== id);
      setTabs(tabsRef.current);
      setUnseenTabIds((prev) => prev.filter((x) => x !== id));
      if (activeRef.current === id) {
        // Activate the last remaining tab, or close the pane (no tabs left).
        const remaining = tabsRef.current;
        markActive(remaining.length > 0 ? remaining[remaining.length - 1].id : undefined);
      }
    },
    [unwatchResource, markActive],
  );

  const handleEvent = useCallback(
    (event: GrackleEvent): boolean => {
      if (event.type === "document.show") {
        const environmentId = event.payload.environmentId;
        const uri = event.payload.uri;
        if (typeof environmentId === "string" && typeof uri === "string") {
          // Agent-initiated: add a tab + badge, never steal focus.
          openDocument({ environmentId, uri }, { focus: false });
        }
        return true;
      }
      if (event.type === "resource.changed") {
        // Observe only — useResources owns the re-read. Badge inactive tabs whose
        // file changed so the user sees there's new content. Return false so the
        // event still reaches the resource bridge (registered after this hook).
        const environmentId = event.payload.environmentId;
        const changes = event.payload.changes;
        if (typeof environmentId === "string" && Array.isArray(changes)) {
          for (const change of changes) {
            const uri = (change as { uri?: unknown }).uri;
            if (typeof uri !== "string") {
              continue;
            }
            const id = tabIdFor(environmentId, uri);
            if (tabsRef.current.some((t) => t.id === id) && activeRef.current !== id) {
              setUnseenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
            }
          }
        }
        return false;
      }
      return false;
    },
    [openDocument],
  );

  const onConnect = useCallback(async (): Promise<void> => {
    // No-op: content resync on reconnect is the resource bridge's job; tabs are
    // ephemeral client state.
  }, []);

  const onDisconnect = useCallback((): void => {
    // No-op: keep tabs across a transient stream blip.
  }, []);

  const domainHook: DomainHook = useMemo(
    () => ({ onConnect, onDisconnect, handleEvent }),
    [onConnect, onDisconnect, handleEvent],
  );

  return {
    tabs,
    activeTabId,
    paneOpen: tabs.length > 0,
    unseenTabIds,
    openDocument,
    closeTab,
    setActiveTab,
    domainHook,
  };
}
