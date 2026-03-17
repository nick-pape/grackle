/**
 * Domain hook for GitHub Codespace management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Codespace, WsMessage, SendFunction } from "./types.js";
import { asValidArray, isCodespace } from "./types.js";

/** Values returned by {@link useCodespaces}. */
export interface UseCodespacesResult {
  /** All known codespaces. */
  codespaces: Codespace[];
  /** Error message from the most recent create attempt, or empty string. */
  codespaceError: string;
  /** Error message from the most recent list attempt, or empty string. */
  codespaceListError: string;
  /** Whether a codespace creation is currently in progress. */
  codespaceCreating: boolean;
  /** Request the current codespace list from the server. */
  listCodespaces: () => void;
  /** Create a new codespace for the given repo. */
  createCodespace: (repo: string, machine?: string) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
}

/**
 * Hook that manages codespace state and actions.
 *
 * @param send - Function to send WebSocket messages.
 * @param connected - Whether the WebSocket is currently connected.
 * @returns Codespace state, actions, and a message handler.
 */
export function useCodespaces(send: SendFunction, connected: boolean): UseCodespacesResult {
  const [codespaces, setCodespaces] = useState<Codespace[]>([]);
  const [codespaceError, setCodespaceError] = useState("");
  const [codespaceListError, setCodespaceListError] = useState("");
  const [codespaceCreating, setCodespaceCreating] = useState(false);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "codespaces_list": {
        const list = asValidArray(
          msg.payload?.codespaces,
          isCodespace,
          "codespaces_list",
          "codespaces",
        );
        const listError =
          typeof msg.payload?.error === "string" ? msg.payload.error : "";
        setCodespaces(list);
        setCodespaceListError(listError);
        return true;
      }
      case "codespace_created":
        setCodespaceCreating(false);
        send({ type: "list_codespaces" });
        return true;
      case "codespace_create_error": {
        setCodespaceCreating(false);
        const createError =
          typeof msg.payload?.message === "string"
            ? msg.payload.message
            : "Failed to create codespace";
        setCodespaceError(createError);
        return true;
      }
      default:
        return false;
    }
  }, [send]);

  const listCodespaces = useCallback(() => {
    send({ type: "list_codespaces" });
  }, [send]);

  const createCodespace = useCallback(
    (repo: string, machine?: string) => {
      if (!connected) {
        setCodespaceError(
          "Not connected to server. Please try again once the connection is restored.",
        );
        return;
      }
      setCodespaceCreating(true);
      setCodespaceError("");
      const payload: Record<string, string> = { repo };
      if (machine) {
        payload.machine = machine;
      }
      send({ type: "create_codespace", payload });
    },
    [send, connected],
  );

  return {
    codespaces,
    codespaceError,
    codespaceListError,
    codespaceCreating,
    listCodespaces,
    createCodespace,
    handleMessage,
  };
}
