/**
 * Centralized URL builder functions and navigation helpers for all application routes.
 *
 * Every component that needs to navigate should import from here
 * instead of hardcoding URL strings.
 */

import { useCallback } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router";

/**
 * Wrapper around react-router's `useNavigate` that returns a fire-and-forget
 * navigate function. This avoids lint conflicts between `no-floating-promises`
 * (which wants the returned `Promise<void> | void` handled) and `no-void`
 * (which forbids the `void` operator).
 */
export function useAppNavigate(): (to: To | number, options?: NavigateOptions) => void {
  const nav = useNavigate();
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        nav(to);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        nav(to, options);
      }
    },
    [nav],
  );
}

/** Build URL for a session detail page. */
export function sessionUrl(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

/** Build URL for a workspace overview page, nested under its environment when available. */
export function workspaceUrl(workspaceId: string, environmentId?: string): string {
  if (environmentId) {
    return `/environments/${encodeURIComponent(environmentId)}/workspaces/${encodeURIComponent(workspaceId)}`;
  }
  // Fallback to legacy route so WorkspaceRedirect can resolve the environment.
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

/** Build URL for a task detail page, optionally targeting a specific tab and workspace/environment scope. */
export function taskUrl(taskId: string, tab?: "stream" | "findings", workspaceId?: string, environmentId?: string): string {
  const encodedTaskId = encodeURIComponent(taskId);
  let base: string;
  if (workspaceId && environmentId) {
    base = `/environments/${encodeURIComponent(environmentId)}/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodedTaskId}`;
  } else if (workspaceId) {
    // Fallback to legacy route so WorkspaceRedirect can resolve the environment.
    base = `/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodedTaskId}`;
  } else {
    base = `/tasks/${encodedTaskId}`;
  }
  if (tab) {
    return `${base}/${tab}`;
  }
  return base;
}

/** Build URL for the task edit page. */
export function taskEditUrl(taskId: string, workspaceId?: string, environmentId?: string): string {
  if (workspaceId && environmentId) {
    return `/environments/${encodeURIComponent(environmentId)}/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/edit`;
  }
  if (workspaceId) {
    // Fallback to legacy route so WorkspaceRedirect can resolve the environment.
    return `/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}/edit`;
  }
  return `/tasks/${encodeURIComponent(taskId)}/edit`;
}

/** Build URL for the new task form. */
export function newTaskUrl(workspaceId?: string, parentTaskId?: string, environmentId?: string): string {
  const params = new URLSearchParams();
  if (workspaceId) {
    params.set("workspace", workspaceId);
  }
  if (parentTaskId) {
    params.set("parent", parentTaskId);
  }
  const qs = params.toString();
  if (workspaceId && environmentId) {
    const base = `/environments/${encodeURIComponent(environmentId)}/workspaces/${encodeURIComponent(workspaceId)}/tasks/new`;
    return parentTaskId ? `${base}?parent=${encodeURIComponent(parentTaskId)}` : base;
  }
  return qs ? `/tasks/new?${qs}` : "/tasks/new";
}

/** Build URL for the new chat form. */
export function newChatUrl(environmentId: string): string {
  const params = new URLSearchParams({ env: environmentId });
  return `/sessions/new?${params.toString()}`;
}

/** URL for the environments landing page. */
export const ENVIRONMENTS_URL: string = "/environments";

/** URL for the new environment form. */
export const NEW_ENVIRONMENT_URL: string = "/environments/new";

/** Build URL for an environment detail page. */
export function environmentUrl(environmentId: string): string {
  return `/environments/${encodeURIComponent(environmentId)}`;
}

/** Build URL for the environment edit page. */
export function environmentEditUrl(environmentId: string): string {
  return `/environments/${encodeURIComponent(environmentId)}/edit`;
}

/** URL for the settings page. */
export const SETTINGS_URL: string = "/settings";

/** URL for the settings environments tab. */
export const SETTINGS_ENVIRONMENTS_URL: string = "/settings/environments";

/** URL for the settings credentials tab. */
export const SETTINGS_CREDENTIALS_URL: string = "/settings/credentials";

/** URL for the persona management tab. */
export const PERSONAS_URL: string = "/settings/personas";

/** URL for the settings appearance tab. */
export const SETTINGS_APPEARANCE_URL: string = "/settings/appearance";

/** URL for the settings about tab. */
export const SETTINGS_ABOUT_URL: string = "/settings/about";

/** URL for the device pairing page. */
export const PAIR_PATH: string = "/pair";

/** URL for the root-task chat page. */
export const CHAT_URL: string = "/chat";

/** URL for the home dashboard page. */
export const HOME_URL: string = "/";

/** URL for the tasks landing page. */
export const TASKS_URL: string = "/tasks";

/** Build URL for the root-task chat page. */
export function chatUrl(): string {
  return CHAT_URL;
}
