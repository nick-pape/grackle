import type { ViewMode } from "../App.js";
import type { TaskData, Project } from "../hooks/useGrackleSocket.js";

/** A single segment in the breadcrumb trail. */
export interface BreadcrumbSegment {
  /** Display label for this segment. */
  label: string;
  /** ViewMode to navigate to when clicked, or undefined for the current (non-clickable) segment. */
  viewMode: ViewMode | undefined;
}

/**
 * Walks up the `parentTaskId` chain from a task to build an ordered list
 * of ancestor tasks (root-first). Includes the task itself as the last element.
 */
export function buildTaskAncestorChain(
  taskId: string,
  tasksById: Map<string, TaskData>,
): TaskData[] {
  const ancestors: TaskData[] = [];
  let currentId: string | undefined = taskId;
  const visited = new Set<string>();

  while (currentId && tasksById.has(currentId)) {
    if (visited.has(currentId)) {
      break; // guard against cycles
    }
    visited.add(currentId);
    const ancestor: TaskData = tasksById.get(currentId)!;
    ancestors.unshift(ancestor);
    currentId = ancestor.parentTaskId || undefined;
  }
  return ancestors;
}

/**
 * Builds a breadcrumb segment list for the current ViewMode.
 *
 * The first segment is always "Home" (maps to `{ kind: "empty" }`).
 * Intermediate segments are clickable; the final segment has `viewMode: undefined`
 * to indicate the current location.
 */
export function buildBreadcrumbs(
  viewMode: ViewMode,
  projects: Project[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[] {
  const home: BreadcrumbSegment = { label: "Home", viewMode: { kind: "empty" } };

  switch (viewMode.kind) {
    case "empty":
      return [{ label: "Home", viewMode: undefined }];

    case "settings":
      return [home, { label: "Settings", viewMode: undefined }];

    case "persona_management":
      return [home, { label: "Personas", viewMode: undefined }];

    case "new_environment":
      return [home, { label: "New Environment", viewMode: undefined }];

    case "project": {
      const project = projects.find((p) => p.id === viewMode.projectId);
      return [
        home,
        { label: project?.name ?? "Project", viewMode: undefined },
      ];
    }

    case "new_task": {
      const project = projects.find((p) => p.id === viewMode.projectId);
      const segments: BreadcrumbSegment[] = [
        home,
        {
          label: project?.name ?? "Project",
          viewMode: { kind: "project", projectId: viewMode.projectId },
        },
      ];

      // If creating a child task, show parent ancestors
      if (viewMode.parentTaskId) {
        const ancestors = buildTaskAncestorChain(viewMode.parentTaskId, tasksById);
        for (const ancestor of ancestors) {
          segments.push({
            label: ancestor.title,
            viewMode: { kind: "task", taskId: ancestor.id },
          });
        }
      }

      segments.push({ label: "New Task", viewMode: undefined });
      return segments;
    }

    case "task": {
      const ancestors = buildTaskAncestorChain(viewMode.taskId, tasksById);
      const task = tasksById.get(viewMode.taskId);
      const projectId = task?.projectId;
      const project = projectId ? projects.find((p) => p.id === projectId) : undefined;

      const segments: BreadcrumbSegment[] = [home];

      if (project) {
        segments.push({
          label: project.name,
          viewMode: { kind: "project", projectId: project.id },
        });
      }

      // Add ancestor tasks (all except the last, which is the current task)
      for (let i = 0; i < ancestors.length - 1; i++) {
        segments.push({
          label: ancestors[i].title,
          viewMode: { kind: "task", taskId: ancestors[i].id },
        });
      }

      // Current task (non-clickable)
      const currentTask = ancestors.at(-1);
      segments.push({
        label: currentTask?.title ?? viewMode.taskId,
        viewMode: undefined,
      });

      return segments;
    }

    case "new_chat": {
      return [home, { label: "New Chat", viewMode: undefined }];
    }

    case "session": {
      return [
        home,
        { label: `Session ${viewMode.sessionId.slice(0, 8)}`, viewMode: undefined },
      ];
    }

    default:
      return [{ label: "Home", viewMode: undefined }];
  }
}
