import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskDirect,
  navigateToTask,
  patchWsForStubMcpRuntime,
} from "./helpers.js";

/**
 * Component registry (#1269) — render-by-reference, end-to-end.
 *
 * A stub-mcp agent registers a reusable component and then renders it BY NAME with
 * fresh props; the broker captures the render and the chat paints it in the
 * cross-origin sandbox. Covers both renderer kinds (the React runtime via
 * grackle-react, and raw HTML via mcp-app-html) plus the one-off render-by-source.
 */

// ── Test 1: register a React component, render it by reference ──
const REACT_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering and rendering a React component:" },
    {
      mcp_call: "component_register",
      args: {
        name: "labeled-button",
        source: "render(<Button>{props.label}</Button>)",
        description: "e2e demo",
        propsSchema: '{"type":"object","properties":{"label":{"type":"string"}}}',
      },
    },
    { mcp_call: "component_list", args: {} },
    {
      mcp_call: "component_render",
      args: { name: "labeled-button", props: { label: "Reused JSX" } },
    },
  ],
});

// ── Test 2: register a raw-HTML component (inline script), render by reference ──
const HTML_BODY = [
  '<!doctype html><html><head><meta charset="utf-8"/></head><body>',
  '<div class="card"><h2>Agent Component</h2>',
  '<div>Inline JS ran: <code id="js">no</code></div></div>',
  '<script>document.getElementById("js").textContent="yes";</script>',
  "</body></html>",
].join("");
const HTML_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering and rendering a raw-HTML component:" },
    {
      mcp_call: "component_register",
      args: { name: "raw-card", source: HTML_BODY, rendererKind: "mcp-app-html" },
    },
    { mcp_call: "component_render", args: { name: "raw-card" } },
  ],
});

// ── Test 3: one-off render-by-source (component_show, #1268) ──
const SHOW_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Rendering a React component from source:" },
    {
      mcp_call: "component_show",
      args: {
        source: "render(<Button>{props.label}</Button>)",
        props: { label: "Hello from JSX" },
      },
    },
  ],
});

// ── Test 4: register then search (#1271) ──
const SEARCH_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering then searching components:" },
    {
      mcp_call: "component_register",
      args: {
        name: "revenue-chart",
        source: "render(<Spinner/>)",
        description: "a chart of revenue over time",
      },
    },
    { mcp_call: "component_search", args: { query: "chart" } },
  ],
});

// ── Test 5: register → promote → render via the dynamic render_<name> tool (#1272) ──
const PROMOTE_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering, promoting, and rendering via the dynamic tool:" },
    {
      mcp_call: "component_register",
      args: {
        name: "promoted-button",
        source: "render(<Button>{props.label}</Button>)",
        propsSchema: '{"type":"object","properties":{"label":{"type":"string"}}}',
      },
    },
    { mcp_call: "component_promote", args: { name: "promoted-button" } },
    // The promoted component is now its own tool; call it BY its render_<slug> name,
    // passing props directly (its inputSchema is the component's propsSchema).
    { mcp_call: "render_promoted_button", args: { label: "Promoted via tool" } },
  ],
});

// ── Test 6: cross-component composition — Parent references registered Child (#1270) ──
const COMPOSE_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering composed components:" },
    {
      mcp_call: "component_register",
      args: {
        name: "Child",
        source: "render(<Button>{props.label}</Button>)",
        propsSchema: '{"type":"object","properties":{"label":{"type":"string"}}}',
      },
    },
    // Parent references the registered Child by JSX tag; the server resolves + bundles it.
    {
      mcp_call: "component_register",
      args: { name: "Parent", source: 'render(<div><Child label="Nested"/></div>)' },
    },
    { mcp_call: "component_render", args: { name: "Parent" } },
  ],
});

// ── Test 7: promote pushes tools/list_changed to a connected conformant client (#1297) ──
const NOTIFY_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Promote then await tools/list_changed:" },
    { mcp_call: "component_register", args: { name: "NotifyChild", source: "render(<Spinner/>)" } },
    // A conformant client: promote, then wait for the server-pushed tools/list_changed and re-list.
    {
      await_tool_change: {
        trigger: { tool: "component_promote", args: { name: "NotifyChild" } },
        expect: "render_NotifyChild",
      },
    },
  ],
});

test.describe("Component registry (#1269)", { tag: ["@persona"] }, () => {
  test("component_register + component_render renders a React component by name", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-react-e2e-proj");
    await createTaskDirect(client, wsId, "render registered component", {
      environmentId: "test-local",
      description: REACT_SCENARIO,
    });
    await navigateToTask(page, "render registered component");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });
    // Render-by-reference: the stored JSX rendered a real Grackle <Button> with fresh props.
    const frame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(frame.getByRole("button", { name: "Reused JSX" })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("component_render of an mcp-app-html component runs its inline script", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-html-e2e-proj");
    await createTaskDirect(client, wsId, "render html component", {
      environmentId: "test-local",
      description: HTML_SCENARIO,
    });
    await navigateToTask(page, "render html component");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });
    const frame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(frame.getByText("Agent Component")).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator("#js")).toHaveText("yes", { timeout: 20_000 });
  });

  test("component_show renders agent JSX against the Grackle component library", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-show-e2e-proj");
    await createTaskDirect(client, wsId, "render react component", {
      environmentId: "test-local",
      description: SHOW_SCENARIO,
    });
    await navigateToTask(page, "render react component");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });
    const frame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(frame.getByRole("button", { name: "Hello from JSX" })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("component_register + component_search runs end-to-end via a scoped agent", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-search-e2e-proj");
    await createTaskDirect(client, wsId, "search components", {
      environmentId: "test-local",
      description: SEARCH_SCENARIO,
    });
    await navigateToTask(page, "search components");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    // Both MCP tools were reachable + executed; the search result surfaces the registered component.
    await expect(page.locator('[data-testid^="tool-card-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("revenue-chart").first()).toBeVisible({ timeout: 15_000 });
  });

  test("component_promote exposes a render_<name> tool that renders by props (#1272)", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-promote-e2e-proj");
    await createTaskDirect(client, wsId, "promote and render", {
      environmentId: "test-local",
      description: PROMOTE_SCENARIO,
    });
    await navigateToTask(page, "promote and render");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    // The dynamic render_promoted_button tool dispatched through the registry and
    // rendered the stored JSX with the props passed straight to the tool.
    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });
    const frame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(frame.getByRole("button", { name: "Promoted via tool" })).toBeVisible({
      timeout: 25_000,
    });
  });

  test("component_render composes a referenced registry component (#1270)", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const wsId = await createWorkspace(client, "component-compose-e2e-proj");
    await createTaskDirect(client, wsId, "compose components", {
      environmentId: "test-local",
      description: COMPOSE_SCENARIO,
    });
    await navigateToTask(page, "compose components");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    // Parent's body referenced <Child/>; the server resolved + bundled Child, and the
    // runtime composed it, so the nested Button (from Child) paints in the sandbox.
    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });
    const frame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(frame.getByRole("button", { name: "Nested" })).toBeVisible({ timeout: 25_000 });
  });

  test("promoting a component pushes tools/list_changed to a connected client (#1297)", async ({
    appPage,
    grackle: { client },
  }) => {
    test.setTimeout(60_000);
    const page = appPage;
    const wsId = await createWorkspace(client, "component-notify-e2e-proj");
    await createTaskDirect(client, wsId, "notify on promote", {
      environmentId: "test-local",
      description: NOTIFY_SCENARIO,
    });
    await navigateToTask(page, "notify on promote");
    await patchWsForStubMcpRuntime(page);
    await page.getByTestId("task-header-start").click();

    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 30_000 });
    // The conformant client promoted NotifyChild, received the server-pushed
    // tools/list_changed, re-listed, and saw render_NotifyChild — the success marker
    // is emitted only on that path.
    await expect(
      page.getByText("tools/list_changed received: render_NotifyChild is now available"),
    ).toBeVisible({ timeout: 25_000 });
  });
});
