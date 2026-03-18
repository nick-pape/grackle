/**
 * Domain hook for project management.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Project, WsMessage, SendFunction } from "./types.js";
import { asValidArray, isProject } from "./types.js";

/** Values returned by {@link useProjects}. */
export interface UseProjectsResult {
  /** All known projects. */
  projects: Project[];
  /** Whether a project creation is currently in progress. */
  projectCreating: boolean;
  /** Create a new project. */
  createProject: (
    name: string,
    description?: string,
    repoUrl?: string,
    defaultEnvironmentId?: string,
    defaultPersonaId?: string,
  ) => void;
  /** Archive a project by ID. */
  archiveProject: (projectId: string) => void;
  /** Update fields on an existing project. */
  updateProject: (
    projectId: string,
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
  /** Reset transient state (e.g. `projectCreating`) on disconnect. */
  onDisconnect: () => void;
}

/**
 * Hook that manages project state and CRUD actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Project state, actions, a message handler, and a disconnect callback.
 */
export function useProjects(send: SendFunction): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectCreating, setProjectCreating] = useState(false);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "projects":
        setProjects(
          asValidArray(
            msg.payload?.projects,
            isProject,
            "projects",
            "projects",
          ),
        );
        return true;
      case "project_created":
        setProjectCreating(false);
        send({ type: "list_projects" });
        return true;
      case "project_archived":
        send({ type: "list_projects" });
        return true;
      case "project_updated":
        send({ type: "list_projects" });
        return true;
      default:
        return false;
    }
  }, [send]);

  const onDisconnect = useCallback(() => {
    setProjectCreating(false);
  }, []);

  const createProject = useCallback(
    (
      name: string,
      description?: string,
      repoUrl?: string,
      defaultEnvironmentId?: string,
      defaultPersonaId?: string,
    ) => {
      setProjectCreating(true);
      send({
        type: "create_project",
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

  const archiveProject = useCallback(
    (projectId: string) => {
      send({ type: "archive_project", payload: { projectId } });
    },
    [send],
  );

  const updateProject = useCallback(
    (
      projectId: string,
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
        type: "update_project",
        payload: { projectId, ...fields },
      });
    },
    [send],
  );

  return {
    projects,
    projectCreating,
    createProject,
    archiveProject,
    updateProject,
    handleMessage,
    onDisconnect,
  };
}
