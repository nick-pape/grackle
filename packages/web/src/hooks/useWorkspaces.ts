/**
 * Domain hook for workspace management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { ConnectError } from "@connectrpc/connect";
import type { Workspace, GrackleEvent, UseWorkspacesResult } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToWorkspace } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseWorkspacesResult } from "@grackle-ai/web-components";

/**
 * Hook that manages workspace state and CRUD actions via ConnectRPC.
 *
 * @returns Workspace state, actions, an event handler, and a disconnect callback.
 */
/** Extracts a user-facing message from a caught error. */
function extractErrorMessage(err: unknown): string {
  return err instanceof ConnectError ? err.message : "Operation failed";
}

export function useWorkspaces(): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const { loading: workspacesLoading, track: trackWorkspaces } = useLoadingState();
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [linkOperationError, setLinkOperationError] = useState("");

  const loadWorkspaces = useCallback(async () => {
    try {
      const resp = await trackWorkspaces(grackleClient.listWorkspaces({}));
      setWorkspaces(resp.workspaces.map(protoToWorkspace));
    } catch {
      // empty
    }
  }, [trackWorkspaces]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "workspace.created":
        setWorkspaceCreating(false);
        loadWorkspaces().catch(() => {});
        return true;
      case "workspace.archived":
      case "workspace.updated":
        loadWorkspaces().catch(() => {});
        return true;
      default:
        return false;
    }
  }, [loadWorkspaces]);

  const onDisconnect = useCallback(() => {
    setWorkspaceCreating(false);
  }, []);

  const createWorkspace = useCallback(
    async (
      name: string,
      description?: string,
      repoUrl?: string,
      environmentId?: string,
      defaultPersonaId?: string,
      useWorktrees?: boolean,
      workingDirectory?: string,
      onSuccess?: () => void,
      onError?: (message: string) => void,
    ) => {
      setWorkspaceCreating(true);
      try {
        await grackleClient.createWorkspace({
          name,
          description: description || "",
          repoUrl: repoUrl || "",
          environmentId: environmentId || "",
          defaultPersonaId: defaultPersonaId || undefined,
          useWorktrees: useWorktrees ?? true,
          workingDirectory: workingDirectory || undefined,
        });
        setWorkspaceCreating(false);
        onSuccess?.();
      } catch (err) {
        setWorkspaceCreating(false);
        const message = err instanceof ConnectError ? err.message : "Failed to create workspace";
        onError?.(message);
      }
    },
    [],
  );

  const archiveWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await grackleClient.archiveWorkspace({ id: workspaceId });
      } catch {
        // empty
      }
    },
    [],
  );

  const updateWorkspace = useCallback(
    async (
      workspaceId: string,
      fields: {
        name?: string;
        description?: string;
        repoUrl?: string;
        environmentId?: string;
        workingDirectory?: string;
        useWorktrees?: boolean;
        defaultPersonaId?: string;
      },
    ) => {
      try {
        await grackleClient.updateWorkspace({ id: workspaceId, ...fields });
      } catch {
        // empty
      }
    },
    [],
  );

  const clearLinkOperationError = useCallback(() => { setLinkOperationError(""); }, []);

  const linkEnvironment = useCallback(
    async (workspaceId: string, environmentId: string) => {
      try {
        setLinkOperationError("");
        await grackleClient.linkEnvironment({ workspaceId, environmentId });
        await loadWorkspaces().catch(() => {});
      } catch (err) {
        setLinkOperationError(extractErrorMessage(err));
      }
    },
    [loadWorkspaces],
  );

  const unlinkEnvironment = useCallback(
    async (workspaceId: string, environmentId: string) => {
      try {
        setLinkOperationError("");
        await grackleClient.unlinkEnvironment({ workspaceId, environmentId });
        await loadWorkspaces().catch(() => {});
      } catch (err) {
        setLinkOperationError(extractErrorMessage(err));
      }
    },
    [loadWorkspaces],
  );

  const domainHook: DomainHook = {
    onConnect: () => loadWorkspaces(),
    onDisconnect,
    handleEvent,
  };

  return {
    workspaces,
    workspacesLoading,
    workspaceCreating,
    loadWorkspaces,
    createWorkspace,
    archiveWorkspace,
    updateWorkspace,
    linkEnvironment,
    unlinkEnvironment,
    linkOperationError,
    clearLinkOperationError,
    handleEvent,
    onDisconnect,
    domainHook,
  };
}
