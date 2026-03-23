/**
 * Domain hook for findings management.
 *
 * Uses ConnectRPC for all operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { FindingData, GrackleEvent } from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToFinding } from "./proto-converters.js";

/** Values returned by {@link useFindings}. */
export interface UseFindingsResult {
  /** All loaded findings. */
  findings: FindingData[];
  /** Load findings for a given workspace. */
  loadFindings: (workspaceId: string) => void;
  /** Post a new finding to a workspace. */
  postFinding: (
    workspaceId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages findings state and actions via ConnectRPC.
 *
 * @returns Findings state, actions, and an event handler.
 */
export function useFindings(): UseFindingsResult {
  const [findings, setFindings] = useState<FindingData[]>([]);

  const loadFindings = useCallback((workspaceId: string) => {
    grackleClient.queryFindings({ workspaceId }).then(
      (resp) => { setFindings(resp.findings.map(protoToFinding)); },
      (err) => { console.error("[grpc] queryFindings failed:", err); },
    );
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "finding.posted") {
      const pid = typeof event.payload.workspaceId === "string" ? event.payload.workspaceId : "";
      if (pid) {
        loadFindings(pid);
      }
      return true;
    }
    return false;
  }, [loadFindings]);

  const postFinding = useCallback(
    (
      workspaceId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      grackleClient.postFinding({
        workspaceId,
        title,
        content,
        category: category ?? "general",
        tags: tags ?? [],
      }).catch(
        (err) => { console.error("[grpc] postFinding failed:", err); },
      );
    },
    [],
  );

  return { findings, loadFindings, postFinding, handleEvent };
}
