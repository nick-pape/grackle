/**
 * Domain hook for GitHub Codespace management.
 *
 * Uses ConnectRPC for all operations.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { ConnectError } from "@connectrpc/connect";
import type { Codespace, UseCodespacesResult } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToCodespace } from "./proto-converters.js";

export type { UseCodespacesResult } from "@grackle-ai/web-components";

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

  const listCodespaces = useCallback(async (githubAccountId?: string) => {
    try {
      const resp = await grackleClient.listCodespaces({ githubAccountId: githubAccountId ?? "" });
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

  const domainHook: DomainHook = {
    onConnect: () => listCodespaces(),
    onDisconnect: () => {},
    handleEvent: () => false,
  };

  return {
    codespaces,
    codespaceError,
    codespaceListError,
    codespaceCreating,
    listCodespaces,
    createCodespace,
    domainHook,
  };
}
