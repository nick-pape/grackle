import { type JSX } from "react";
import { useParams } from "react-router";
import { TaskEditPanel } from "../components/panels/TaskEditPanel.js";

/** Page for editing an existing task, reading taskId from route params. */
export function TaskEditPage(): JSX.Element {
  const { taskId } = useParams<{ taskId: string }>();

  return (
    <TaskEditPanel
      mode="edit"
      taskId={taskId!}
    />
  );
}
