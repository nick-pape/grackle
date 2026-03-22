import { type JSX } from "react";
import { useParams, useSearchParams } from "react-router";
import { TaskEditPanel } from "../components/panels/TaskEditPanel.js";

/** Page for creating a new task, reading workspaceId and parentTaskId from route or query params. */
export function NewTaskPage(): JSX.Element {
  const { workspaceId: routeWorkspaceId, environmentId: routeEnvironmentId } = useParams<{ workspaceId?: string; environmentId?: string }>();
  const [searchParams] = useSearchParams();
  const workspaceId = routeWorkspaceId ?? searchParams.get("workspace") ?? "";
  const parentTaskId = searchParams.get("parent") ?? undefined;

  return (
    <TaskEditPanel
      mode="new"
      workspaceId={workspaceId}
      parentTaskId={parentTaskId}
      environmentId={routeEnvironmentId}
    />
  );
}
