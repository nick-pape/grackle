/**
 * Domain hook for findings management.
 *
 * Uses ConnectRPC for all operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { FindingData, GrackleEvent } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToFinding } from "./proto-converters.js";

/** Values returned by {@link useFindings}. */
export interface UseFindingsResult {
  /** All loaded findings. */
  findings: FindingData[];
  /** The currently selected finding (loaded by ID). `undefined` while loading or when not found. */
  selectedFinding: FindingData | undefined;
  /** Whether a single finding is being loaded. */
  findingLoading: boolean;
  /** Load findings for a given workspace. */
  loadFindings: (workspaceId: string) => void;
  /** Load findings across all workspaces. */
  loadAllFindings: () => void;
  /** Load a single finding by ID. */
  loadFinding: (findingId: string) => void;
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
  const [selectedFinding, setSelectedFinding] = useState<FindingData | undefined>(undefined);
  const [findingLoading, setFindingLoading] = useState(false);

  const loadFindings = useCallback(async (workspaceId: string) => {
    try {
      const resp = await grackleClient.queryFindings({ workspaceId });
      setFindings(resp.findings.map(protoToFinding));
    } catch {
      // empty
    }
  }, []);

  const loadAllFindings = useCallback(async () => {
    try {
      const resp = await grackleClient.queryFindings({ workspaceId: "" });
      setFindings(resp.findings.map(protoToFinding));
    } catch {
      // empty
    }
  }, []);

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

  /* eslint-disable @typescript-eslint/no-misused-promises -- async hooks returned as fire-and-forget void actions */
  return { findings, selectedFinding, findingLoading, loadFindings, loadAllFindings, loadFinding, postFinding, handleEvent };
}
