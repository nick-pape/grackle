import { type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { useToast } from "@grackle-ai/web-components";
import { TaskEditPanel } from "@grackle-ai/web-components/src/components/panels/TaskEditPanel.js";

/** Page for editing an existing task, reading taskId from route params. */
export function TaskEditPage(): JSX.Element {
  const { taskId, workspaceId, environmentId } = useParams<{ taskId: string; workspaceId?: string; environmentId?: string }>();
  const { tasks, workspaces, personas, createTask, updateTask } = useGrackle();
  const { showToast } = useToast();

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
      onShowToast={showToast}
    />
  );
}
