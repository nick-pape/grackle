import { type JSX } from "react";
import { Navigate, useSearchParams } from "react-router";
import { TaskEditPanel } from "../components/panels/TaskEditPanel.js";

/** Page for creating a new task, reading projectId and parentTaskId from query params. */
export function NewTaskPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project") ?? "";
  const parentTaskId = searchParams.get("parent") ?? undefined;

  // Redirect to home when the required project param is missing.
  if (!projectId) {
    return <Navigate to="/" replace />;
  }

  return (
    <TaskEditPanel
      mode="new"
      projectId={projectId}
      parentTaskId={parentTaskId}
    />
  );
}
