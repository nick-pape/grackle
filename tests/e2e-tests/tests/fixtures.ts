import { test as base, type Page, type TestInfo } from "@playwright/test";
import { startGrackleStack, stopGrackleStack, type E2EState } from "./server-manager.js";
import {
  provisionEnvironmentDirect,
  createWorkspace,
  createTaskWithScenario,
  createTask as createTaskHelper,
  createTaskViaWs,
  navigateToTask,
  patchWsForStubRuntime,
  getWorkspaceId,
} from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScenarioStep = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsPayload = Record<string, any>;

/** Context object provided by the `stubTask` fixture. */
export interface StubTaskContext {
  /** The underlying Playwright page (same as `appPage`). */
  page: Page;
  /** Unique workspace name created for this test. */
  workspaceName: string;
  /** Create a scenario task, navigate to it, and return. */
  createAndNavigate(title: string, scenario: { steps: ScenarioStep[] }): Promise<void>;
  /** Create a task (no scenario) and navigate to it. */
  createAndNavigateSimple(title: string, environmentId?: string): Promise<void>;
  /** Create a task via WS (for tests needing task IDs or custom options). */
  createTask(title: string, options?: {
    environmentId?: string;
    dependsOn?: string[];
    description?: string;
    parentTaskId?: string;
    canDecompose?: boolean;
  }): Promise<WsPayload>;
}

/** Simple deterministic hash to avoid workspace name collisions. */
function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

/** Derive a unique workspace name from the test's title path. */
function workspaceNameFromTest(testInfo: TestInfo): string {
  // titlePath is e.g. ["", "Task Lifecycle (stub runtime)", "full task flow: ..."]
  // Combine all non-empty segments, slugify, and add workerIndex for uniqueness
  const baseTitle = testInfo.titlePath.slice(1).join("-");
  const slug = baseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const hash = shortHash(baseTitle);
  const retryPart = testInfo.retry ? `-r${testInfo.retry}` : "";
  const repeatPart = testInfo.repeatEachIndex ? `-re${testInfo.repeatEachIndex}` : "";
  return `ws-${slug}-w${testInfo.workerIndex}${retryPart}${repeatPart}-${hash}`;
}

interface WorkerFixtures {
  workerServer: E2EState;
}

interface TestFixtures {
  grackle: { apiKey: string; baseURL: string; wsUrl: string; mcpPort: number; grpcPort: number };
  appPage: Page;
  stubTask: StubTaskContext;
}

/** Extended Playwright test fixture that spawns a per-worker Grackle stack. */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: starts one Grackle stack per worker (4 ports + isolated DB).
  // Teardown kills processes and removes the temp directory when the worker exits.
  workerServer: [async ({}, use) => {
    const state = await startGrackleStack();
    await use(state);
    await stopGrackleStack(state);
  }, { scope: "worker" }],

  // Override Playwright's built-in baseURL so page.goto("/") resolves to the dynamic port
  baseURL: async ({ workerServer }, use) => {
    await use(`http://127.0.0.1:${workerServer.webPort}`);
  },

  // Inject the session cookie into every page context automatically
  page: async ({ page, baseURL, workerServer }, use) => {
    const eqIdx = workerServer.pairingCookie.indexOf("=");
    const cookieName = workerServer.pairingCookie.slice(0, eqIdx);
    const cookieValue = workerServer.pairingCookie.slice(eqIdx + 1);
    await page.context().addCookies([{
      name: cookieName,
      value: cookieValue,
      url: baseURL!,
    }]);
    await use(page);
  },

  grackle: async ({ baseURL, workerServer }, use) => {
    const wsUrl = `ws://127.0.0.1:${workerServer.webPort}`;
    await use({ apiKey: workerServer.apiKey, baseURL: baseURL!, wsUrl, mcpPort: workerServer.mcpPort, grpcPort: workerServer.serverPort });
  },

  appPage: async ({ page, workerServer }, use) => {
    // Expose server details via env vars so helpers can access them without STATE_FILE
    process.env.GRACKLE_E2E_SERVER_PORT = String(workerServer.serverPort);
    process.env.GRACKLE_E2E_API_KEY = workerServer.apiKey;

    // Ensure the test-local environment is connected before each test.
    // Previous spec files may have stopped it.
    await provisionEnvironmentDirect("test-local", workerServer.serverPort, workerServer.apiKey);

    // Expose gRPC server details so test helpers can call server-streaming
    // RPCs (like ProvisionEnvironment) on the HTTP/2 gRPC port directly.
    await page.addInitScript(`
      window.__GRACKLE_GRPC_PORT__ = ${workerServer.serverPort};
      window.__GRACKLE_API_KEY__ = ${JSON.stringify(workerServer.apiKey)};
    `);

    await page.goto("/");
    // Wait for the WebSocket to connect and initial data to load.
    // "Connected" appears when WS connects; the env count appears once
    // ListEnvironments completes via ConnectRPC.
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected") &&
            /\d+\/\d+ env/.test(document.body.innerText),
      { timeout: 10_000 },
    );
    await use(page);
  },

  stubTask: async ({ appPage }, use, testInfo) => {
    const page = appPage;
    const workspaceName = workspaceNameFromTest(testInfo);

    // Create a unique workspace for this test
    await createWorkspace(page, workspaceName);

    // Patch fetch() to force stub runtime — done once per test
    await patchWsForStubRuntime(page);

    const context: StubTaskContext = {
      page,
      workspaceName,

      async createAndNavigate(title: string, scenario: { steps: ScenarioStep[] }): Promise<void> {
        await createTaskWithScenario(page, workspaceName, title, scenario);
        await navigateToTask(page, title);
      },

      async createAndNavigateSimple(title: string, environmentId?: string): Promise<void> {
        await createTaskHelper(page, workspaceName, title, environmentId || "test-local");
        await navigateToTask(page, title);
      },

      async createTask(title: string, options?: {
        environmentId?: string;
        dependsOn?: string[];
        description?: string;
        parentTaskId?: string;
        canDecompose?: boolean;
      }): Promise<WsPayload> {
        const wsId = await getWorkspaceId(page, workspaceName);
        return createTaskViaWs(page, wsId, title, options);
      },
    };

    await use(context);
  },
});

export { expect } from "@playwright/test";
export type { StubTaskContext };
