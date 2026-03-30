/**
 * Domain hook for findings management.
 *
 * Uses ConnectRPC for all operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { FindingData, GrackleEvent, UseFindingsResult } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToFinding } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseFindingsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages findings state and actions via ConnectRPC.
 *
 * @returns Findings state, actions, and an event handler.
 */
export function useFindings(): UseFindingsResult {
  const [findings, setFindings] = useState<FindingData[]>([]);
  const [selectedFinding, setSelectedFinding] = useState<FindingData | undefined>(undefined);
  const [findingLoading, setFindingLoading] = useState(false);
  const { loading: findingsLoading, track: trackFindings } = useLoadingState();

  const loadFindings = useCallback(async (workspaceId: string) => {
    try {
      const resp = await trackFindings(grackleClient.queryFindings({ workspaceId }));
      setFindings(resp.findings.map(protoToFinding));
    } catch {
      // empty
    }
  }, [trackFindings]);

  const loadAllFindings = useCallback(async () => {
    try {
      const resp = await trackFindings(grackleClient.queryFindings({ workspaceId: "" }));
      setFindings(resp.findings.map(protoToFinding));
    } catch {
      // empty
    }
  }, [trackFindings]);

  const loadFinding = useCallback(async (findingId: string) => {
    setSelectedFinding(undefined);
    setFindingLoading(true);
    try {
      const resp = await grackleClient.getFinding({ id: findingId });
      setSelectedFinding(protoToFinding(resp));
    } catch {
      setSelectedFinding(undefined);
    } finally {
      setFindingLoading(false);
    }
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "finding.posted") {
      const pid = typeof event.payload.workspaceId === "string" ? event.payload.workspaceId : "";
      if (pid) {
        loadFindings(pid).catch(() => {});
      }
      return true;
    }
    return false;
  }, [loadFindings]);

  const postFinding = useCallback(
    async (
      workspaceId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      try {
        await grackleClient.postFinding({
          workspaceId,
          title,
          content,
          category: category ?? "general",
          tags: tags ?? [],
        });
      } catch {
        // empty
      }
    },
    [],
  );

  const domainHook: DomainHook = {
    onConnect: () => loadAllFindings(),
    onDisconnect: () => {},
    handleEvent,
  };

  return { findings, selectedFinding, findingLoading, findingsLoading, loadFindings, loadAllFindings, loadFinding, postFinding, handleEvent, domainHook };
}
