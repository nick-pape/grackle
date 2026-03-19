/**
 * Domain hook for findings management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { FindingData, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isFindingData } from "./types.js";

/** Values returned by {@link useFindings}. */
export interface UseFindingsResult {
  /** All loaded findings. */
  findings: FindingData[];
  /** Load findings for a given project. */
  loadFindings: (projectId: string) => void;
  /** Post a new finding to a project. */
  postFinding: (
    projectId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
}

/**
 * Hook that manages findings state and actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Findings state, actions, and a message handler.
 */
export function useFindings(send: SendFunction): UseFindingsResult {
  const [findings, setFindings] = useState<FindingData[]>([]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "finding.posted") {
      const pid = typeof event.payload.projectId === "string" ? event.payload.projectId : "";
      if (pid) {
        send({ type: "list_findings", payload: { projectId: pid } });
      }
      return true;
    }
    return false;
  }, [send]);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "findings":
        setFindings(
          asValidArray(
            msg.payload?.findings,
            isFindingData,
            "findings",
            "findings",
          ),
        );
        return true;
      default:
        return false;
    }
  }, []);

  const loadFindings = useCallback(
    (projectId: string) => {
      send({ type: "list_findings", payload: { projectId } });
    },
    [send],
  );

  const postFinding = useCallback(
    (
      projectId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      send({
        type: "post_finding",
        payload: {
          projectId,
          title,
          content,
          category: category || "general",
          tags: tags || [],
        },
      });
    },
    [send],
  );

  return { findings, loadFindings, postFinding, handleMessage, handleEvent };
}
