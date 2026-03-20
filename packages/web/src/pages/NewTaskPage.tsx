import { type JSX } from "react";
import { useSearchParams } from "react-router";
import { TaskEditPanel } from "../components/panels/TaskEditPanel.js";

/** Page for creating a new task, reading workspaceId and parentTaskId from query params. */
export function NewTaskPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get("workspace") ?? "";
  const parentTaskId = searchParams.get("parent") ?? undefined;

  return (
    <TaskEditPanel
      mode="new"
      workspaceId={workspaceId}
      parentTaskId={parentTaskId}
    />
  );
}
