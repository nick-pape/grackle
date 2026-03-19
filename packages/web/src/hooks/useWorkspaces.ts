/**
 * Domain hook for workspace management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Workspace, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isWorkspace } from "./types.js";

/** Values returned by {@link useWorkspaces}. */
export interface UseWorkspacesResult {
  /** All known workspaces. */
  workspaces: Workspace[];
  /** Whether a workspace creation is currently in progress. */
  workspaceCreating: boolean;
  /** Create a new workspace. */
  createWorkspace: (
    name: string,
    description?: string,
    repoUrl?: string,
    defaultEnvironmentId?: string,
    defaultPersonaId?: string,
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
      defaultEnvironmentId?: string;
      worktreeBasePath?: string;
      useWorktrees?: boolean;
      defaultPersonaId?: string;
    },
  ) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state (e.g. `workspaceCreating`) on disconnect. */
  onDisconnect: () => void;
}

/**
 * Hook that manages workspace state and CRUD actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Workspace state, actions, a message handler, and a disconnect callback.
 */
export function useWorkspaces(send: SendFunction): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "workspace.created":
        setWorkspaceCreating(false);
        send({ type: "list_workspaces" });
        return true;
      case "workspace.archived":
      case "workspace.updated":
        send({ type: "list_workspaces" });
        return true;
      default:
        return false;
    }
  }, [send]);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "workspaces":
        setWorkspaces(
          asValidArray(
            msg.payload?.workspaces,
            isWorkspace,
            "workspaces",
            "workspaces",
          ),
        );
        return true;
      default:
        return false;
    }
  }, []);

  const onDisconnect = useCallback(() => {
    setWorkspaceCreating(false);
  }, []);

  const createWorkspace = useCallback(
    (
      name: string,
      description?: string,
      repoUrl?: string,
      defaultEnvironmentId?: string,
      defaultPersonaId?: string,
    ) => {
      setWorkspaceCreating(true);
      send({
        type: "create_workspace",
        payload: {
          name,
          description: description || "",
          repoUrl: repoUrl || "",
          defaultEnvironmentId: defaultEnvironmentId || "",
          defaultPersonaId: defaultPersonaId || "",
        },
      });
    },
    [send],
  );

  const archiveWorkspace = useCallback(
    (workspaceId: string) => {
      send({ type: "archive_workspace", payload: { workspaceId } });
    },
    [send],
  );

  const updateWorkspace = useCallback(
    (
      workspaceId: string,
      fields: {
        name?: string;
        description?: string;
        repoUrl?: string;
        defaultEnvironmentId?: string;
        worktreeBasePath?: string;
        useWorktrees?: boolean;
        defaultPersonaId?: string;
      },
    ) => {
      send({
        type: "update_workspace",
        payload: { workspaceId, ...fields },
      });
    },
    [send],
  );

  return {
    workspaces,
    workspaceCreating,
    createWorkspace,
    archiveWorkspace,
    updateWorkspace,
    handleMessage,
    handleEvent,
    onDisconnect,
  };
}
