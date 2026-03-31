import type { Environment, TaskData, Workspace } from "../hooks/types.js";
import { ENVIRONMENTS_URL, environmentUrl, FINDINGS_URL, findingsUrl, HOME_URL, SETTINGS_URL, taskUrl, workspaceUrl } from "./navigation.js";

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
const HOME_SEGMENT: BreadcrumbSegment = { label: "Home", url: HOME_URL };

/** Build breadcrumbs for the home page. */
export function buildHomeBreadcrumbs(): BreadcrumbSegment[] {
  return [{ label: "Home", url: undefined }];
}

/** Build breadcrumbs for the settings page, optionally showing the active tab. */
export function buildSettingsBreadcrumbs(tabLabel?: string): BreadcrumbSegment[] {
  if (tabLabel) {
    return [HOME_SEGMENT, { label: "Settings", url: SETTINGS_URL }, { label: tabLabel, url: undefined }];
  }
  return [HOME_SEGMENT, { label: "Settings", url: undefined }];
}

/** Environments breadcrumb segment. */
const ENVIRONMENTS_SEGMENT: BreadcrumbSegment = { label: "Environments", url: ENVIRONMENTS_URL };

/** Build breadcrumbs for the environments landing page. */
export function buildEnvironmentsBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "Environments", url: undefined }];
}

/** Build breadcrumbs for the new environment page. */
export function buildNewEnvironmentBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, ENVIRONMENTS_SEGMENT, { label: "New Environment", url: undefined }];
}

/** Build breadcrumbs for the new chat page. */
export function buildNewChatBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "New Chat", url: undefined }];
}

/** Build breadcrumbs for a session page. */
export function buildSessionBreadcrumbs(sessionId: string): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: `Session ${sessionId.slice(0, 8)}`, url: undefined }];
}

/** Build breadcrumbs for a workspace page: Home > Environments > [Env] > [Workspace]. */
export function buildWorkspaceBreadcrumbs(
  workspaceId: string,
  environmentId: string,
  workspaces: Workspace[],
  environments: Environment[],
): BreadcrumbSegment[] {
  const workspace = workspaces.find((p) => p.id === workspaceId);
  const environment = environments.find((e) => e.id === environmentId);
  return [
    HOME_SEGMENT,
    ENVIRONMENTS_SEGMENT,
    { label: environment?.displayName ?? "Environment", url: environmentUrl(environmentId) },
    { label: workspace?.name ?? "Workspace", url: undefined },
  ];
}

/** Build breadcrumbs for a task page: Home > Environments > [Env] > [Workspace] > [ancestors...] > [Task]. */
export function buildTaskBreadcrumbs(
  taskId: string,
  routeEnvironmentId: string | undefined,
  workspaces: Workspace[],
  environments: Environment[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[] {
  const ancestors = buildTaskAncestorChain(taskId, tasksById);
  const task = tasksById.get(taskId);
  const taskWorkspaceId = task?.workspaceId;
  const workspace = taskWorkspaceId ? workspaces.find((p) => p.id === taskWorkspaceId) : undefined;
  const environmentId = routeEnvironmentId ?? workspace?.linkedEnvironmentIds[0];
  const environment = environmentId ? environments.find((e) => e.id === environmentId) : undefined;

  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  if (environment && environmentId) {
    segments.push(ENVIRONMENTS_SEGMENT);
    segments.push({ label: environment.displayName, url: environmentUrl(environmentId) });
  }

  if (workspace && environmentId) {
    segments.push({
      label: workspace.name,
      url: workspaceUrl(workspace.id, environmentId),
    });
  }

  // Add ancestor tasks (all except the last, which is the current task)
  for (let i = 0; i < ancestors.length - 1; i++) {
    segments.push({
      label: ancestors[i].title,
      url: taskUrl(ancestors[i].id, undefined, taskWorkspaceId, environmentId),
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

/** Build breadcrumbs for the new task page. */
export function buildNewTaskBreadcrumbs(
  workspaceIdParam: string,
  environmentId: string | undefined,
  parentTaskId: string | undefined,
  workspaces: Workspace[],
  environments: Environment[],
  tasksById: Map<string, TaskData>,
): BreadcrumbSegment[] {
  const workspace = workspaces.find((p) => p.id === workspaceIdParam);
  const envId = environmentId ?? workspace?.linkedEnvironmentIds[0];
  const environment = envId ? environments.find((e) => e.id === envId) : undefined;

  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  if (environment && envId) {
    segments.push(ENVIRONMENTS_SEGMENT);
    segments.push({ label: environment.displayName, url: environmentUrl(envId) });
  }

  if (envId) {
    segments.push({
      label: workspace?.name ?? "Workspace",
      url: workspaceUrl(workspaceIdParam, envId),
    });
  } else {
    segments.push({
      label: workspace?.name ?? "Workspace",
      url: undefined,
    });
  }

  // If creating a child task, show parent ancestors
  if (parentTaskId) {
    const ancestors = buildTaskAncestorChain(parentTaskId, tasksById);
    for (const ancestor of ancestors) {
      segments.push({
        label: ancestor.title,
        url: taskUrl(ancestor.id, undefined, workspaceIdParam, envId),
      });
    }
  }

  segments.push({ label: "New Task", url: undefined });
  return segments;
}

/** Findings breadcrumb segment. */
const FINDINGS_SEGMENT: BreadcrumbSegment = { label: "Findings", url: FINDINGS_URL };

/** Build breadcrumbs for the findings landing page. */
export function buildFindingsBreadcrumbs(): BreadcrumbSegment[] {
  return [HOME_SEGMENT, { label: "Findings", url: undefined }];
}

/** Build breadcrumbs for a finding detail page, optionally scoped to a workspace. */
export function buildFindingBreadcrumbs(
  findingTitle: string,
  workspaceId: string | undefined,
  environmentId: string | undefined,
  workspaces: Workspace[],
  environments: Environment[],
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [HOME_SEGMENT];

  if (workspaceId && environmentId) {
    const workspace = workspaces.find((p) => p.id === workspaceId);
    const environment = environments.find((e) => e.id === environmentId);
    segments.push(ENVIRONMENTS_SEGMENT);
    if (environment) {
      segments.push({ label: environment.displayName, url: environmentUrl(environmentId) });
    }
    if (workspace) {
      segments.push({ label: workspace.name, url: workspaceUrl(workspaceId, environmentId) });
    }
    segments.push({ label: "Findings", url: findingsUrl(workspaceId, environmentId) });
  } else {
    segments.push(FINDINGS_SEGMENT);
  }

  segments.push({ label: findingTitle, url: undefined });
  return segments;
}
