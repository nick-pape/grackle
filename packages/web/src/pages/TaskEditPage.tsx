import { type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { TaskEditPanel } from "../components/panels/TaskEditPanel.js";

/** Page for editing an existing task, reading taskId from route params. */
export function TaskEditPage(): JSX.Element {
  const { taskId, workspaceId, environmentId } = useParams<{ taskId: string; workspaceId?: string; environmentId?: string }>();
  const { tasks, workspaces, personas, createTask, updateTask } = useGrackle();

  return (
    <TaskEditPanel
      mode="edit"
      taskId={taskId!}
      workspaceId={workspaceId}
      environmentId={environmentId}
      tasks={tasks}
      workspaces={workspaces}
      personas={personas}
      onCreateTask={createTask}
      onUpdateTask={updateTask}
    />
  );
}
