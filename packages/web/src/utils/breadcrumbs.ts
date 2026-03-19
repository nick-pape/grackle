import type { TaskData, Workspace } from "../hooks/useGrackleSocket.js";
import { taskUrl, workspaceUrl } from "./navigation.js";

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

/** Build breadcrumbs for the settings page, optionally showing the active tab. */
export function buildSettingsBreadcrumbs(tabLabel?: string): BreadcrumbSegment[] {
  if (tabLabel) {
    return [HOME_SEGMENT, { label: "Settings", url: "/settings" }, { label: tabLabel, url: undefined }];
  }
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

/**
 * Build breadcrumbs for a workspace page.
 *
 * @deprecated Workspace routes are being removed. Kept for backward compatibility.
 */
export function buildWorkspaceBreadcrumbs(
  workspaceId: string,
  workspaces: Workspace[],
): BreadcrumbSegment[] {
  const workspace = workspaces.find((p) => p.id === workspaceId);
  return [HOME_SEGMENT, { label: workspace?.name ?? "Workspace", url: undefined }];
}

/** Build breadcrumbs for a task page (new 2-param signature). */
export function buildTaskBreadcrumbs(
  taskId: string,
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[];
/**
 * Build breadcrumbs for a task page (legacy 3-param signature).
 *
 * @deprecated Use the 2-param overload instead (workspace segment removed).
 */
export function buildTaskBreadcrumbs(
  taskId: string,
  workspaces: Workspace[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[];
/** Build breadcrumbs for a task page. */
export function buildTaskBreadcrumbs(
  taskId: string,
  second: Map<string, TaskData> | Workspace[],
  third?: Map<string, TaskData>,
): BreadcrumbSegment[] {
  // Resolve overloads: if second is an array, it is the legacy (workspaces, tasksById) form.
  const isLegacy = Array.isArray(second);
  const workspaces: Workspace[] | undefined = isLegacy ? second : undefined;
  const tasksById: Map<string, TaskData> = isLegacy ? third! : second;

  const ancestors = buildTaskAncestorChain(taskId, tasksById);
  const task = tasksById.get(taskId);

  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  // Legacy callers expect a workspace segment
  if (workspaces) {
    const taskWorkspaceId = task?.workspaceId;
    const workspace = taskWorkspaceId ? workspaces.find((p) => p.id === taskWorkspaceId) : undefined;
    if (workspace) {
      segments.push({
        label: workspace.name,
        url: workspaceUrl(workspace.id),
      });
    }
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- currentTask may be undefined if ancestors is empty
    label: currentTask?.title ?? taskId,
    url: undefined,
  });

  return segments;
}

/** Build breadcrumbs for the new task page (new 2-param signature). */
export function buildNewTaskBreadcrumbs(
  parentTaskId: string | undefined,
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[];
/**
 * Build breadcrumbs for the new task page (legacy 4-param signature).
 *
 * @deprecated Use the 2-param overload instead (workspace segment removed).
 */
export function buildNewTaskBreadcrumbs(
  workspaceIdParam: string,
  parentTaskId: string | undefined,
  workspaces: Workspace[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[];
/** Build breadcrumbs for the new task page. */
export function buildNewTaskBreadcrumbs(
  first: string | undefined,
  second: Map<string, TaskData> | string | undefined,
  third?: Workspace[],
  fourth?: Map<string, TaskData>,
): BreadcrumbSegment[] {
  // Resolve overloads: legacy 4-param has (workspaceIdParam: string, parentTaskId: string|undefined, workspaces, tasksById)
  // New 2-param has (parentTaskId: string|undefined, tasksById: Map)
  const isLegacy = third !== undefined || (typeof second === "string" || second === undefined);
  let parentTaskId: string | undefined;
  let tasksById: Map<string, TaskData>;
  let workspaces: Workspace[] | undefined;
  let workspaceIdParam: string | undefined;

  if (isLegacy && !(second instanceof Map)) {
    workspaceIdParam = first ?? "";
    parentTaskId = typeof second === "string" ? second : undefined;
    workspaces = third;
    tasksById = fourth!;
  } else {
    parentTaskId = first;
    tasksById = second as Map<string, TaskData>;
  }

  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  // Legacy callers expect a workspace segment
  if (workspaces && workspaceIdParam) {
    const workspace = workspaces.find((p) => p.id === workspaceIdParam);
    segments.push({
      label: workspace?.name ?? "Workspace",
      url: workspaceUrl(workspaceIdParam),
    });
  }

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
