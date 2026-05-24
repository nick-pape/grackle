import { test, expect } from "./fixtures.js";
import { createWorkspace, createTaskDirect, navigateToTask, patchWsForStubMcpRuntime } from "./helpers.js";

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
    { mcp_call: "component_render", args: { name: "labeled-button", props: { label: "Reused JSX" } } },
  ],
});

// ── Test 2: register a raw-HTML component (inline script), render by reference ──
const HTML_BODY = [
  "<!doctype html><html><head><meta charset=\"utf-8\"/></head><body>",
  "<div class=\"card\"><h2>Agent Component</h2>",
  "<div>Inline JS ran: <code id=\"js\">no</code></div></div>",
  "<script>document.getElementById(\"js\").textContent=\"yes\";</script>",
  "</body></html>",
].join("");
const HTML_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Registering and rendering a raw-HTML component:" },
    { mcp_call: "component_register", args: { name: "raw-card", source: HTML_BODY, rendererKind: "mcp-app-html" } },
    { mcp_call: "component_render", args: { name: "raw-card" } },
  ],
});

// ── Test 3: one-off render-by-source (component_show, #1268) ──
const SHOW_SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Rendering a React component from source:" },
    { mcp_call: "component_show", args: { source: "render(<Button>{props.label}</Button>)", props: { label: "Hello from JSX" } } },
  ],
});

test.describe("Component registry (#1269)", { tag: ["@persona"] }, () => {
  test("component_register + component_render renders a React component by name", async ({ appPage, grackle: { client } }) => {
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
    await expect(frame.getByRole("button", { name: "Reused JSX" })).toBeVisible({ timeout: 25_000 });
  });

  test("component_render of an mcp-app-html component runs its inline script", async ({ appPage, grackle: { client } }) => {
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

  test("component_show renders agent JSX against the Grackle component library", async ({ appPage, grackle: { client } }) => {
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
    await expect(frame.getByRole("button", { name: "Hello from JSX" })).toBeVisible({ timeout: 25_000 });
  });
});
