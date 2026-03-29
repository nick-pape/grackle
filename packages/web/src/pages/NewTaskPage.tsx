import { type JSX } from "react";
import { useParams, useSearchParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { TaskEditPanel, useToast } from "@grackle-ai/web-components";

/** Page for creating a new task, reading workspaceId and parentTaskId from route or query params. */
export function NewTaskPage(): JSX.Element {
  const { workspaceId: routeWorkspaceId, environmentId: routeEnvironmentId } = useParams<{ workspaceId?: string; environmentId?: string }>();
  const [searchParams] = useSearchParams();
  const workspaceId = routeWorkspaceId ?? searchParams.get("workspace") ?? "";
  const parentTaskId = searchParams.get("parent") ?? undefined;
  const { tasks, workspaces, personas, createTask, updateTask } = useGrackle();
  const { showToast } = useToast();

  return (
    <TaskEditPanel
      mode="new"
      workspaceId={workspaceId}
      parentTaskId={parentTaskId}
      environmentId={routeEnvironmentId}
      tasks={tasks}
      workspaces={workspaces}
      personas={personas}
      onCreateTask={(wsId, title, desc, deps, parentId, personaId, canDecompose, onSuccess, onError) => { createTask(wsId, title, desc, deps, parentId, personaId, canDecompose, onSuccess, onError).catch(() => {}); }}
      onUpdateTask={(tid, title, desc, deps, personaId) => { updateTask(tid, title, desc, deps, personaId).catch(() => {}); }}
      onShowToast={showToast}
    />
  );
}
