import type { Page } from "@playwright/test";
import type { GrackleClient } from "./rpc-client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsPayload = Record<string, any>;

// ── Internal: browser-context RPC (used only by navigation helpers) ──

/**
 * Call a ConnectRPC method from the browser page context via fetch.
 * Used internally by navigation helpers that need the Playwright page.
 */
async function callRpc(
  page: Page,
  method: string,
  body: WsPayload,
): Promise<WsPayload> {
  return page.evaluate(
    async ({ method: m, body: b }) => {
      const resp = await fetch(`/grackle.Grackle/${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
        credentials: "include",
      });
      const text = await resp.text();
      if (!resp.ok) {
        let errMsg = text;
        try {
          const errObj = JSON.parse(text);
          errMsg = errObj.message || errObj.code || text;
        } catch { /* raw text */ }
        throw new Error(errMsg);
      }
      return text ? JSON.parse(text) : {};
    },
    { method, body },
  );
}

// ── RPC Data Helpers (typed client, runs in Node.js) ─────────────────

/** Retrieve the workspace ID for a workspace with the given name. */
export async function getWorkspaceId(
  client: GrackleClient,
  workspaceName: string,
): Promise<string> {
  const resp = await client.listWorkspaces({});
  const workspace = resp.workspaces.find((w) => w.name === workspaceName);
  if (!workspace) {
    throw new Error(`Workspace "${workspaceName}" not found`);
  }
  return workspace.id;
}

/** Retrieve the task ID for a task with the given title under a workspace. */
export async function getTaskId(
  client: GrackleClient,
  workspaceId: string,
  taskTitle: string,
): Promise<string> {
  const resp = await client.listTasks({ workspaceId });
  const task = resp.tasks.find((t) => t.title === taskTitle);
  if (!task) {
    throw new Error(`Task "${taskTitle}" not found in workspace ${workspaceId}`);
  }
  return task.id;
}

/**
 * Create a workspace via RPC.
 * Returns the workspace ID.
 */
export async function createWorkspace(
  client: GrackleClient,
  name: string,
  environmentId: string = "test-local",
): Promise<string> {
  const resp = await client.createWorkspace({ name, environmentId });
  return resp.id;
}

/**
 * Create a task via typed RPC. Returns the created task data.
 * Replaces the old `createTaskViaWs`.
 */
export async function createTaskDirect(
  client: GrackleClient,
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
  const resp = await client.createTask({
    workspaceId,
    title,
    description: options?.description || "",
    dependsOn: options?.dependsOn || [],
    parentTaskId: options?.parentTaskId || "",
    canDecompose: options?.canDecompose,
  });
  return resp as unknown as WsPayload;
}

/**
 * Create a task under a workspace (looked up by name) via RPC.
 */
export async function createTask(
  client: GrackleClient,
  workspaceName: string,
  title: string,
  envName?: string,
  options?: { canDecompose?: boolean },
): Promise<void> {
  const wsId = await getWorkspaceId(client, workspaceName);
  await createTaskDirect(client, wsId, title, {
    environmentId: envName || "",
    canDecompose: options?.canDecompose,
  });
}

// ── Navigation Helpers (need Playwright page) ────────────────────────

/**
 * Navigate to a workspace page by looking up its ID via RPC and then
 * navigating to `/workspaces/:workspaceId`.
 */
export async function navigateToWorkspace(page: Page, workspaceName: string): Promise<void> {
  const rpcResp = await callRpc(page, "ListWorkspaces", {});
  const workspaces = (rpcResp.workspaces || []) as Array<{ id: string; name: string }>;
  const workspace = workspaces.find((w) => w.name === workspaceName);
  if (!workspace) {
    throw new Error(`Workspace "${workspaceName}" not found`);
  }
  await page.goto(`/workspaces/${workspace.id}`);
  await page.waitForFunction(
    () => document.body.innerText.includes("Connected"),
    { timeout: 10_000 },
  );
  await page.locator('[data-testid="workspace-name"]').waitFor({ timeout: 5_000 });
}

/**
 * Navigate to a task view by clicking its name on the page.
 * Falls back to looking up the task ID via RPC and navigating by URL.
 */
export async function navigateToTask(
  page: Page,
  taskTitle: string,
): Promise<void> {
  const taskLink = page.getByText(taskTitle, { exact: true }).first();
  const isVisible = await taskLink.isVisible().catch(() => false);

  if (isVisible) {
    await taskLink.click();
  } else {
    const rpcResp = await callRpc(page, "ListWorkspaces", {});
    const workspaces = (rpcResp.workspaces || []) as Array<{ id: string }>;

    let taskId: string | undefined;
    for (const ws of workspaces) {
      try {
        const tasksResp = await callRpc(page, "ListTasks", { workspaceId: ws.id });
        const tasks = (tasksResp.tasks || []) as Array<{ id: string; title: string }>;
        const task = tasks.find((t) => t.title === taskTitle);
        if (task) {
          taskId = task.id;
          break;
        }
      } catch {
        // Task not in this workspace, try next
      }
    }

    if (!taskId) {
      throw new Error(`Task "${taskTitle}" not found in any workspace`);
    }

    await page.goto(`/tasks/${taskId}`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
  }

  await page.locator(`[data-testid="task-title"]:has-text("${taskTitle}")`).waitFor({ timeout: 5_000 });
}

/** Navigate to settings and wait for the tab nav to appear. */
export async function goToSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-settings"]').click();
  await page.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });
}

/** Navigate to the Environments tab in the sidebar. */
export async function goToEnvironments(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-environments"]').click();
}

// ── Browser-Context Helpers (fetch patching) ─────────────────────────

/**
 * Monkey-patch fetch() to force the "Stub" persona and inject environmentId on
 * StartTask/SpawnAgent requests.
 */
export async function patchWsForStubRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFetch = (window as any).__origFetch__ || window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__origFetch__ = origFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
      if ((url.includes("/grackle.Grackle/StartTask") || url.includes("/grackle.Grackle/SpawnAgent")) && init?.body) {
        try {
          let bodyStr: string;
          if (init.body instanceof Uint8Array) {
            bodyStr = new TextDecoder().decode(init.body);
          } else {
            bodyStr = init.body as string;
          }
          const body = JSON.parse(bodyStr);
          body.personaId = "stub";
          if (!body.environmentId) {
            body.environmentId = envId;
          }
          const newBodyStr = JSON.stringify(body);
          init = { ...init, body: new TextEncoder().encode(newBodyStr) };
        } catch {
          /* not JSON, pass through */
        }
      }
      return origFetch.call(this, input, init);
    };
  }, environmentId);
}

/**
 * Monkey-patch fetch() to force the "Stub MCP" persona and inject environmentId
 * on StartTask/SpawnAgent requests.
 */
export async function patchWsForStubMcpRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFetch = (window as any).__origFetch__ || window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__origFetch__ = origFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
      if ((url.includes("/grackle.Grackle/StartTask") || url.includes("/grackle.Grackle/SpawnAgent")) && init?.body) {
        try {
          let bodyStr: string;
          if (init.body instanceof Uint8Array) {
            bodyStr = new TextDecoder().decode(init.body);
          } else {
            bodyStr = init.body as string;
          }
          const body = JSON.parse(bodyStr);
          body.personaId = "stub-mcp";
          if (!body.environmentId) {
            body.environmentId = envId;
          }
          const newBodyStr = JSON.stringify(body);
          init = { ...init, body: new TextEncoder().encode(newBodyStr) };
        } catch {
          /* not JSON, pass through */
        }
      }
      return origFetch.call(this, input, init);
    };
  }, environmentId);
}

/**
 * Run a stub task through its full lifecycle: start -> working -> idle -> send input -> paused.
 * Requires patchWsForStubRuntime to have been called on the page beforehand.
 */
export async function runStubTaskToCompletion(page: Page): Promise<void> {
  await page.getByTestId("task-header-start").click();

  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/**
 * Run a stub-mcp task through its full lifecycle.
 * Requires patchWsForStubMcpRuntime to have been called on the page beforehand.
 */
export async function runStubMcpTaskToCompletion(page: Page): Promise<void> {
  await page.getByTestId("task-header-start").click();

  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/**
 * Provision an environment via gRPC. No-ops if already connected.
 */
export async function provisionEnvironmentDirect(
  environmentId: string,
  client: GrackleClient,
): Promise<void> {
  try {
    for await (const _ of client.provisionEnvironment({ id: environmentId })) {
      // Drain provision events
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already connected") && !msg.includes("Already connected")) {
      throw err;
    }
  }
}

// ─── Scriptable Stub Runtime Helpers ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScenarioStep = Record<string, any>;

/**
 * Create a task with a JSON scenario as the description.
 */
export async function createTaskWithScenario(
  client: GrackleClient,
  workspaceName: string,
  title: string,
  scenario: { steps: ScenarioStep[] },
  envName: string = "test-local",
): Promise<void> {
  const wsId = await getWorkspaceId(client, workspaceName);
  await createTaskDirect(client, wsId, title, {
    description: JSON.stringify(scenario),
    environmentId: envName,
  });
}

// ─── Scenario Builder Helpers ───────────────────────────────

/** Build a complete scenario object from steps. */
export function stubScenario(...steps: ScenarioStep[]): { steps: ScenarioStep[] } {
  return { steps };
}
/** Emit a text event. */
export function emitText(content: string): ScenarioStep {
  return { emit: "text", content };
}

/** Emit a tool_use event with auto-generated content and raw fields. */
export function emitToolUse(tool: string, args: Record<string, unknown> = {}): ScenarioStep {
  return { emit: "tool_use", tool, args };
}

/** Emit a tool_result event. */
export function emitToolResult(content: string, raw?: Record<string, unknown>): ScenarioStep {
  const step: ScenarioStep = { emit: "tool_result", content };
  if (raw) {
    step.raw = raw;
  }
  return step;
}

/** Emit a finding event. */
export function emitFinding(content: string): ScenarioStep {
  return { emit: "finding", content };
}

/** Emit a subtask_create event. */
export function emitSubtaskCreate(
  title: string,
  description: string,
  options?: { localId?: string; dependsOn?: string[]; canDecompose?: boolean },
): ScenarioStep {
  const step: ScenarioStep = { emit: "subtask_create", title, description };
  if (options?.localId) {
    step.local_id = options.localId;
  }
  if (options?.dependsOn) {
    step.depends_on = options.dependsOn;
  }
  if (options?.canDecompose !== undefined) {
    step.can_decompose = options.canDecompose;
  }
  return step;
}

/** Emit a usage event. */
export function emitUsage(data: Record<string, unknown>): ScenarioStep {
  return { emit: "usage", content: JSON.stringify(data) };
}

/** Emit an error event. */
export function emitError(content: string): ScenarioStep {
  return { emit: "error", content };
}

/** Go idle and wait for user input. */
export function idle(): ScenarioStep {
  return { idle: true };
}

/** Sleep for N milliseconds. */
export function waitMs(ms: number): ScenarioStep {
  return { wait: ms };
}

/** Set the default input handling action for subsequent idle steps. */
export function onInput(action: "echo" | "fail" | "ignore" | "next"): ScenarioStep {
  return { on_input: action };
}

/** Set pattern-matching rules for input handling. Use "*" as the fallback key. */
export function onInputMatch(rules: Record<string, "echo" | "fail" | "ignore" | "next">): ScenarioStep {
  return { on_input_match: rules };
}

/** Make a real MCP tool call via the broker. Requires a broker-enabled stub session (spawned with mcpBroker/workspaceId). */
export function emitMcpCall(tool: string, args?: Record<string, unknown>): ScenarioStep {
  const step: ScenarioStep = { mcp_call: tool };
  if (args) {
    step.args = args;
  }
  return step;
}
