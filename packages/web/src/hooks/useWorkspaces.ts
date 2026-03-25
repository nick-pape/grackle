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
import type { Workspace, GrackleEvent } from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToWorkspace } from "./proto-converters.js";

/** Values returned by {@link useWorkspaces}. */
export interface UseWorkspacesResult {
  /** All known workspaces. */
  workspaces: Workspace[];
  /** Whether a workspace creation is currently in progress. */
  workspaceCreating: boolean;
  /** Request the current workspace list from the server. */
  loadWorkspaces: () => void;
  /** Create a new workspace. */
  createWorkspace: (
    name: string,
    description?: string,
    repoUrl?: string,
    environmentId?: string,
    defaultPersonaId?: string,
    useWorktrees?: boolean,
    workingDirectory?: string,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => void;
  /** Archive a workspace by ID. */
  archiveWorkspace: (workspaceId: string) => void;
  /** Update fields on an existing workspace. */
  updateWorkspace: (
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
  ) => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state (e.g. `workspaceCreating`) on disconnect. */
  onDisconnect: () => void;
}

/**
 * Hook that manages workspace state and CRUD actions via ConnectRPC.
 *
 * @returns Workspace state, actions, an event handler, and a disconnect callback.
 */
export function useWorkspaces(): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);

  const loadWorkspaces = useCallback(() => {
    grackleClient.listWorkspaces({}).then(
      (resp) => { setWorkspaces(resp.workspaces.map(protoToWorkspace)); },
      () => {},
    );
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "workspace.created":
        setWorkspaceCreating(false);
        loadWorkspaces();
        return true;
      case "workspace.archived":
      case "workspace.updated":
        loadWorkspaces();
        return true;
      default:
        return false;
    }
  }, [loadWorkspaces]);

  const onDisconnect = useCallback(() => {
    setWorkspaceCreating(false);
  }, []);

  const createWorkspace = useCallback(
    (
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
      grackleClient.createWorkspace({
        name,
        description: description || "",
        repoUrl: repoUrl || "",
        environmentId: environmentId || "",
        defaultPersonaId: defaultPersonaId || undefined,
        useWorktrees: useWorktrees ?? true,
        workingDirectory: workingDirectory || undefined,
      }).then(
        () => {
          setWorkspaceCreating(false);
          onSuccess?.();
        },
        (err) => {
          setWorkspaceCreating(false);
          const message = err instanceof ConnectError ? err.message : "Failed to create workspace";
          onError?.(message);
        },
      );
    },
    [],
  );

  const archiveWorkspace = useCallback(
    (workspaceId: string) => {
      grackleClient.archiveWorkspace({ id: workspaceId }).catch(
        () => {},
      );
    },
    [],
  );

  const updateWorkspace = useCallback(
    (
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
      grackleClient.updateWorkspace({ id: workspaceId, ...fields }).catch(
        () => {},
      );
    },
    [],
  );

  return {
    workspaces,
    workspaceCreating,
    loadWorkspaces,
    createWorkspace,
    archiveWorkspace,
    updateWorkspace,
    handleEvent,
    onDisconnect,
  };
}
