import type { TaskData, Project } from "../hooks/useGrackleSocket.js";
import { projectUrl, taskUrl } from "./navigation.js";

/** A single segment in the breadcrumb trail. */
export interface BreadcrumbSegment {
  /** Display label for this segment. */
  label: string;
  /** URL to navigate to when clicked, or undefined for the current (non-clickable) segment. */
  url: string | undefined;
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

/** Home breadcrumb segment. */
const HOME_SEGMENT: BreadcrumbSegment = { label: "Home", url: "/" };

/** Build breadcrumbs for the home page. */
export function buildHomeBreadcrumbs(): BreadcrumbSegment[] {
  return [{ label: "Home", url: undefined }];
}

/** Build breadcrumbs for the settings page. */
export function buildSettingsBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "Settings", url: undefined }];
}

/** Build breadcrumbs for the new environment page. */
export function buildNewEnvironmentBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "New Environment", url: undefined }];
}

/** Build breadcrumbs for the new chat page. */
export function buildNewChatBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "New Chat", url: undefined }];
}

/** Build breadcrumbs for a session page. */
export function buildSessionBreadcrumbs(sessionId: string): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: `Session ${sessionId.slice(0, 8)}`, url: undefined }];
}

/** Build breadcrumbs for a project page. */
export function buildProjectBreadcrumbs(
  projectId: string,
  projects: Project[],
): BreadcrumbSegment[] {
  const project = projects.find((p) => p.id === projectId);
  return [HOME_SEGMENT, { label: project?.name ?? "Project", url: undefined }];
}

/** Build breadcrumbs for a task page. */
export function buildTaskBreadcrumbs(
  taskId: string,
  projects: Project[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[] {
  const ancestors = buildTaskAncestorChain(taskId, tasksById);
  const task = tasksById.get(taskId);
  const taskProjectId = task?.projectId;
  const project = taskProjectId ? projects.find((p) => p.id === taskProjectId) : undefined;

  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  if (project) {
    segments.push({
      label: project.name,
      url: projectUrl(project.id),
    });
  }

  // Add ancestor tasks (all except the last, which is the current task)
  for (let i = 0; i < ancestors.length - 1; i++) {
    segments.push({
      label: ancestors[i].title,
      url: taskUrl(ancestors[i].id),
    });
  }

  // Current task (non-clickable)
  const currentTask = ancestors[ancestors.length - 1];
  segments.push({
    label: currentTask?.title ?? taskId,
    url: undefined,
  });

  return segments;
}

/** Build breadcrumbs for the new task page. */
export function buildNewTaskBreadcrumbs(
  projectIdParam: string,
  parentTaskId: string | undefined,
  projects: Project[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[] {
  const project = projects.find((p) => p.id === projectIdParam);
  const segments: BreadcrumbSegment[] = [
    HOME_SEGMENT,
    {
      label: project?.name ?? "Project",
      url: projectUrl(projectIdParam),
    },
  ];

  // If creating a child task, show parent ancestors
  if (parentTaskId) {
    const ancestors = buildTaskAncestorChain(parentTaskId, tasksById);
    for (const ancestor of ancestors) {
      segments.push({
        label: ancestor.title,
        url: taskUrl(ancestor.id),
      });
    }
  }

  segments.push({ label: "New Task", url: undefined });
  return segments;
}
