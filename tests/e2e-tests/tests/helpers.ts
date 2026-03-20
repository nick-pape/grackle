import type { Page } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsPayload = Record<string, any>;

/**
 * Open a second WebSocket from the page context, send a message, and wait for
 * a response matching the given type. Resolves with the full response object.
 */
export async function sendWsAndWaitFor(
  page: Page,
  message: WsPayload,
  responseType: string,
  timeoutMs = 10_000,
): Promise<WsPayload> {
  return page.evaluate(
    async ({ msg, respType, timeout }) => {
      return new Promise<WsPayload>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://${window.location.host}`,
        );
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`WS timeout waiting for "${respType}"`));
        }, timeout);
        ws.onmessage = (e: MessageEvent) => {
          const data = JSON.parse(e.data);
          if (data.type === respType) {
            clearTimeout(timer);
            ws.close();
            resolve(data);
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          ws.close();
          reject(new Error("WS connection error"));
        };
        ws.onopen = () => {
          ws.send(JSON.stringify(msg));
        };
      });
    },
    { msg: message, respType: responseType, timeout: timeoutMs },
  );
}

/**
 * Send a WS message without waiting for a specific response.
 * Opens a second WS, sends the message, waits briefly for server processing, then closes.
 */
export async function sendWsMessage(
  page: Page,
  message: WsPayload,
): Promise<void> {
  await page.evaluate(async (msg) => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://${window.location.host}`,
      );
      ws.onerror = () => {
        ws.close();
        reject(new Error("WS error"));
      };
      ws.onopen = () => {
        ws.send(JSON.stringify(msg));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 500);
      };
    });
  }, message);
}

/** Retrieve the workspace ID for a workspace with the given name. */
export async function getWorkspaceId(
  page: Page,
  workspaceName: string,
): Promise<string> {
  const response = await sendWsAndWaitFor(
    page,
    { type: "list_workspaces" },
    "workspaces",
  );
  const workspaces = (response.payload?.workspaces || []) as Array<{
    id: string;
    name: string;
  }>;
  const workspace = workspaces.find((w) => w.name === workspaceName);
  if (!workspace) {
    throw new Error(`Workspace "${workspaceName}" not found`);
  }
  return workspace.id;
}

/** @deprecated Use {@link getWorkspaceId} instead. */
export const getProjectId = getWorkspaceId;

/** Retrieve the task ID for a task with the given title under a workspace. */
export async function getTaskId(
  page: Page,
  workspaceId: string,
  taskTitle: string,
): Promise<string> {
  const response = await sendWsAndWaitFor(
    page,
    { type: "list_tasks", payload: { workspaceId } },
    "tasks",
  );
  const tasks = (response.payload?.tasks || []) as Array<{
    id: string;
    title: string;
  }>;
  const task = tasks.find((t) => t.title === taskTitle);
  if (!task) {
    throw new Error(`Task "${taskTitle}" not found in workspace ${workspaceId}`);
  }
  return task.id;
}

/**
 * Create a workspace via WebSocket and wait for it to appear in the sidebar.
 * Requires the test environment ("test-local") to already exist.
 */
export async function createWorkspace(page: Page, name: string, environmentId: string = "test-local"): Promise<void> {
  await sendWsAndWaitFor(
    page,
    {
      type: "create_workspace",
      payload: { name, environmentId },
    },
    "workspace.created",
  );
  // Wait for the workspace to appear in the sidebar after the event triggers a refresh
  await page.getByText(name).waitFor({ timeout: 5_000 });
}

/** @deprecated Use {@link createWorkspace} instead. */
export const createProject = createWorkspace;

/**
 * Create a task under a workspace and wait for it to appear in the sidebar.
 *
 * When `envName` is provided the task is created via WebSocket so the
 * environment can be carried through (task creation UI no longer has an env
 * dropdown). When `envName` is omitted the new full-panel TaskEditPanel UI
 * is exercised.
 */
export async function createTask(
  page: Page,
  workspaceName: string,
  title: string,
  envName?: string,
  options?: { canDecompose?: boolean },
): Promise<void> {
  if (envName) {
    // Environment must be set at creation via WS (UI no longer has env field).
    // Navigate to the task edit form via the "New task" sidebar button (this uses
    // stopPropagation so it never toggles the workspace's expand/collapse state —
    // unlike clicking the workspace name which collapses if already selected).
    await page
      .getByText(workspaceName)
      .locator("..")
      .locator('button[title="New task"]')
      .first()
      .click();
    await page.locator('[data-testid="task-edit-title"]').waitFor({ timeout: 5_000 });

    // Create the task via WS while the form is visible.
    const wsId = await getWorkspaceId(page, workspaceName);
    await createTaskViaWs(page, wsId, title, { environmentId: envName, canDecompose: options?.canDecompose });

    // Cancel the form — this navigates to workspace view which auto-expands
    // the workspace in the sidebar via useEffect in WorkspaceList.
    await page.locator("button", { hasText: "Cancel" }).click();

    await page
      .getByText(title, { exact: true })
      .first()
      .waitFor({ timeout: 5_000 });
    return;
  }

  // No env specified — exercise the new full-panel TaskEditPanel UI.
  // Click "New task" button (uses stopPropagation, doesn't toggle expansion)
  await page
    .getByText(workspaceName)
    .locator("..")
    .locator('button[title="New task"]')
    .first()
    .click();

  // Fill in task title in the new full-panel form
  await page.locator('[data-testid="task-edit-title"]').fill(title);
  await page.locator('[data-testid="task-edit-save"]').click();

  // After "Create", viewMode goes to workspace → auto-expand. Wait for task in sidebar.
  // Use .first() because AnimatePresence may briefly keep an exiting copy alongside the
  // entering copy, causing two <span class="taskTitle"> elements with the same text.
  await page
    .getByText(title, { exact: true })
    .first()
    .waitFor({ timeout: 5_000 });
}

/** Navigate to a task view by clicking its name in the sidebar. */
export async function navigateToTask(
  page: Page,
  taskTitle: string,
): Promise<void> {
  await page.getByText(taskTitle).first().click();
  // Wait for the task detail header to show this specific task's title.
  // Using data-testid="task-title" (which wraps only the title text) to avoid strict-mode
  // violations from the task name appearing in both the sidebar and the header.
  await page.locator(`[data-testid="task-title"]:has-text("${taskTitle}")`).waitFor({ timeout: 5_000 });
}

/**
 * Monkey-patch WebSocket.prototype.send to force the "Stub" persona and inject
 * environmentId on start_task messages. The server resolves the runtime from
 * the persona (not a runtime field), so we set personaId to "stub" which maps
 * to the "Stub" persona created in global-setup. Environment is now a
 * start-time param (not stored on the task), so tests must provide it explicitly.
 */
export async function patchWsForStubRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (
      data: string | ArrayBuffer | Blob | ArrayBufferView,
    ) {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "start_task") {
            msg.payload.personaId = "stub";
            if (!msg.payload.environmentId) {
              msg.payload.environmentId = envId;
            }
            data = JSON.stringify(msg);
          }
        } catch {
          /* not JSON, pass through */
        }
      }
      return origSend.call(this, data);
    };
  }, environmentId);
}

/**
 * Run a stub task through its full lifecycle: start → working → idle → send input → paused.
 * Requires patchWsForStubRuntime to have been called on the page beforehand.
 */
export async function runStubTaskToCompletion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // Wait for idle state (session waiting for input)
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Wait for session to complete and task to move to paused (review).
  // "Resume" only appears in paused state, unlike "Stop" which is in both
  // working and paused states.
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/**
 * Send a WS message and wait for an "error" response.
 * Convenience wrapper around sendWsAndWaitFor for error-path testing.
 */
export async function sendWsAndWaitForError(
  page: Page,
  message: WsPayload,
  timeoutMs = 10_000,
): Promise<WsPayload> {
  return sendWsAndWaitFor(page, message, "error", timeoutMs);
}

/**
 * Inject a fake WS message into the app's existing WebSocket connection.
 * Calls the onmessage handler directly on the first OPEN tracked WebSocket.
 * Requires installWsTracker to have been called via addInitScript before page.goto.
 */
export async function injectWsMessage(
  page: Page,
  message: WsPayload,
): Promise<void> {
  await page.evaluate((msg) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sockets = (window as any).__grackle_ws_instances__ as
      | WebSocket[]
      | undefined;
    if (!sockets) {
      throw new Error(
        "WS tracker not installed — call installWsTracker before page.goto",
      );
    }
    // Find the app's socket (first OPEN one — helper sockets are already closed)
    const ws = sockets.find((s) => s.readyState === WebSocket.OPEN);
    if (!ws) {
      throw new Error(`No OPEN WebSocket found (tracked: ${sockets.length})`);
    }
    // The app uses ws.onmessage (not addEventListener), so call it directly
    if (ws.onmessage) {
      ws.onmessage(
        new MessageEvent("message", {
          data: JSON.stringify(msg),
        }),
      );
    }
  }, message);
}

/**
 * Install a hook via addInitScript that records all WebSocket instances opened by the app.
 * Must be called BEFORE page.goto so the script runs before app JavaScript.
 * Used by injectWsMessage to find the app's active socket.
 */
export async function installWsTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__grackle_ws_instances__ = [];
    const OrigWs = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__OrigWebSocket__ = OrigWs;
    // @ts-expect-error — we're wrapping the constructor
    window.WebSocket = function (
      ...args: ConstructorParameters<typeof WebSocket>
    ) {
      const ws = new OrigWs(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__grackle_ws_instances__.push(ws);
      return ws;
    } as unknown as typeof WebSocket;
    window.WebSocket.prototype = OrigWs.prototype;
    Object.defineProperty(window.WebSocket, "CONNECTING", {
      value: OrigWs.CONNECTING,
    });
    Object.defineProperty(window.WebSocket, "OPEN", { value: OrigWs.OPEN });
    Object.defineProperty(window.WebSocket, "CLOSING", {
      value: OrigWs.CLOSING,
    });
    Object.defineProperty(window.WebSocket, "CLOSED", { value: OrigWs.CLOSED });
  });
}

/** Create a task via WebSocket with custom options (e.g., dependsOn, parentTaskId). Returns the created task data. */
export async function createTaskViaWs(
  page: Page,
  workspaceId: string,
  title: string,
  options?: {
    environmentId?: string;
    dependsOn?: string[];
    description?: string;
    parentTaskId?: string;
    canDecompose?: boolean;
  },
): Promise<WsPayload> {
  const payload: WsPayload = {
    workspaceId,
    title,
    description: options?.description || "",
    environmentId: options?.environmentId || "",
    dependsOn: options?.dependsOn || [],
    parentTaskId: options?.parentTaskId || "",
  };
  if (options?.canDecompose !== undefined) {
    payload.canDecompose = options.canDecompose;
  }
  const response = await sendWsAndWaitFor(
    page,
    {
      type: "create_task",
      payload,
    },
    "task.created",
  );
  // The event bus sends { taskId, workspaceId } — fetch the full task row
  const taskId = response.payload?.taskId as string;
  if (taskId) {
    const listResp = await sendWsAndWaitFor(
      page,
      { type: "list_tasks", payload: { workspaceId } },
      "tasks",
    );
    const tasks = (listResp.payload?.tasks || []) as WsPayload[];
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      return task;
    }
  }
  // Fallback: return the event payload itself
  return (response.payload ?? {}) as WsPayload;
}

/**
 * Monkey-patch WebSocket.prototype.send to force the "Stub MCP" persona and
 * inject environmentId on start_task messages. The server resolves the runtime
 * from the persona (not a runtime field), so we set personaId to "stub-mcp"
 * which maps to the "Stub MCP" persona created in global-setup.
 */
export async function patchWsForStubMcpRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (
      data: string | ArrayBuffer | Blob | ArrayBufferView,
    ) {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "start_task") {
            msg.payload.personaId = "stub-mcp";
            if (!msg.payload.environmentId) {
              msg.payload.environmentId = envId;
            }
            data = JSON.stringify(msg);
          }
        } catch {
          /* not JSON, pass through */
        }
      }
      return origSend.call(this, data);
    };
  }, environmentId);
}

/**
 * Run a stub-mcp task through its full lifecycle: start -> working -> idle -> send input -> paused.
 * Requires patchWsForStubMcpRuntime to have been called on the page beforehand.
 */
export async function runStubMcpTaskToCompletion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // Wait for idle state (session waiting for input)
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Wait for session to complete and task to move to paused (review).
  // "Resume" only appears in paused state, unlike "Stop" which is in both
  // working and paused states.
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/** Navigate to settings and wait for the tab nav to appear. */
export async function goToSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-settings"]').click();
  await page.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });
}
