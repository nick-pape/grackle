/**
 * Domain hook for GitHub Codespace management.
 *
 * Uses ConnectRPC for all operations.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { ConnectError } from "@connectrpc/connect";
import type { Codespace } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToCodespace } from "./proto-converters.js";

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
  listCodespaces: () => Promise<void>;
  /** Create a new codespace for the given repo. */
  createCodespace: (repo: string, machine?: string) => Promise<void>;
}

/**
 * Hook that manages codespace state and actions via ConnectRPC.
 *
 * @returns Codespace state and actions.
 */
export function useCodespaces(): UseCodespacesResult {
  const [codespaces, setCodespaces] = useState<Codespace[]>([]);
  const [codespaceError, setCodespaceError] = useState("");
  const [codespaceListError, setCodespaceListError] = useState("");
  const [codespaceCreating, setCodespaceCreating] = useState(false);

  const listCodespaces = useCallback(async () => {
    try {
      const resp = await grackleClient.listCodespaces({});
      setCodespaces(resp.codespaces.map(protoToCodespace));
      setCodespaceListError(resp.error);
    } catch {
      // empty
    }
  }, []);

  const createCodespace = useCallback(
    async (repo: string, machine?: string) => {
      setCodespaceCreating(true);
      setCodespaceError("");
      try {
        await grackleClient.createCodespace({ repo, machine: machine ?? "" });
        setCodespaceCreating(false);
        await listCodespaces();
      } catch (err) {
        setCodespaceCreating(false);
        const message = err instanceof ConnectError
          ? err.message
          : "Failed to create codespace";
        setCodespaceError(message);
      }
    },
    [listCodespaces],
  );

  return {
    codespaces,
    codespaceError,
    codespaceListError,
    codespaceCreating,
    listCodespaces,
    createCodespace,
  };
}
