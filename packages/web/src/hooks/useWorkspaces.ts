/**
 * Domain hook for workspace management.
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import type { Workspace, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isWorkspace } from "./types.js";

/** Pending create-workspace callback entry keyed by requestId. */
interface PendingCreateWorkspaceCallback {
  onSuccess: () => void;
  onError: (message: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long to wait for a create-workspace response before timing out. */
const CREATE_WORKSPACE_TIMEOUT_MS: number = 15_000;

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
    environmentId?: string,
    defaultPersonaId?: string,
    useWorktrees?: boolean,
    worktreeBasePath?: string,
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
  const pendingCreatesRef = useRef<Map<string, PendingCreateWorkspaceCallback>>(
    new Map(),
  );

  const syncWorkspaceCreating = useCallback((): void => {
    setWorkspaceCreating(pendingCreatesRef.current.size > 0);
  }, []);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "workspace.created": {
        const requestId =
          typeof event.payload.requestId === "string"
            ? event.payload.requestId
            : "";
        if (requestId) {
          const pending = pendingCreatesRef.current.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingCreatesRef.current.delete(requestId);
            syncWorkspaceCreating();
            pending.onSuccess();
          }
        }
        send({ type: "list_workspaces" });
        return true;
      }
      case "workspace.archived":
      case "workspace.updated":
        send({ type: "list_workspaces" });
        return true;
      default:
        return false;
    }
  }, [send, syncWorkspaceCreating]);

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
      case "create_workspace_error": {
        const requestId =
          typeof msg.payload?.requestId === "string"
            ? msg.payload.requestId
            : "";
        const errorMessage =
          typeof msg.payload?.message === "string"
            ? msg.payload.message
            : "Failed to create workspace";
        setWorkspaceCreating(false);
        if (requestId) {
          const pending = pendingCreatesRef.current.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingCreatesRef.current.delete(requestId);
            syncWorkspaceCreating();
            pending.onError(errorMessage);
          } else {
            console.error(
              "Received create_workspace_error for unknown requestId",
              { requestId, errorMessage },
            );
          }
        } else {
          console.error(
            "Received create_workspace_error without requestId",
            { errorMessage },
          );
        }
        return true;
      }
      default:
        return false;
    }
  }, [syncWorkspaceCreating]);

  const onDisconnect = useCallback(() => {
    for (const [, pending] of pendingCreatesRef.current) {
      clearTimeout(pending.timer);
      pending.onError("Disconnected");
    }
    pendingCreatesRef.current.clear();
    syncWorkspaceCreating();
  }, [syncWorkspaceCreating]);

  const createWorkspace = useCallback(
    (
      name: string,
      description?: string,
      repoUrl?: string,
      environmentId?: string,
      defaultPersonaId?: string,
      useWorktrees?: boolean,
      worktreeBasePath?: string,
      onSuccess?: () => void,
      onError?: (message: string) => void,
    ) => {
      const payload: Record<string, unknown> = {
        name,
        description: description || "",
        repoUrl: repoUrl || "",
        environmentId: environmentId || "",
        defaultPersonaId: defaultPersonaId || "",
        useWorktrees: useWorktrees ?? true,
        worktreeBasePath: worktreeBasePath || "",
      };
      const requestId = crypto.randomUUID();
      payload.requestId = requestId;
      const errorCallback = onError ?? (() => {});
      const timer = setTimeout(() => {
        if (pendingCreatesRef.current.delete(requestId)) {
          syncWorkspaceCreating();
          errorCallback("Request timed out");
        }
      }, CREATE_WORKSPACE_TIMEOUT_MS);
      pendingCreatesRef.current.set(requestId, {
        onSuccess: onSuccess ?? (() => {}),
        onError: errorCallback,
        timer,
      });
      syncWorkspaceCreating();
      send({
        type: "create_workspace",
        payload,
      });
    },
    [send, syncWorkspaceCreating],
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
        environmentId?: string;
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
