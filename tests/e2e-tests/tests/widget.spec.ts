import { test, expect } from "./fixtures.js";
import { createWorkspace, createTaskDirect, navigateToTask, patchWsForStubMcpRuntime } from "./helpers.js";

/**
 * Agent-authored widget registry (#1239) — end-to-end.
 *
 * A stub-mcp agent runs a scenario that registers a widget and then renders it
 * by name; the broker captures the render and the chat paints the widget in the
 * cross-origin sandbox. This locks the full render contract (tool -> broker
 * event -> EventRenderer rendererKind dispatch -> McpAppWidget -> sandbox), incl.
 * that an agent-authored inline `<script>` executes under the relaxed sandbox CSP.
 */

// Agent-authored body with an inline script that flips #js to "yes" on load —
// proving inline scripts run in the (origin-isolated) sandbox.
const WIDGET_BODY = [
  "<!doctype html><html><head><meta charset=\"utf-8\"/>",
  "<style>body{font-family:sans-serif;padding:16px}.card{border:1px solid #ccc;border-radius:8px;padding:16px}</style>",
  "</head><body><div class=\"card\"><h2>Agent Widget</h2>",
  "<div>Inline JS ran: <code id=\"js\">no</code></div></div>",
  "<script>document.getElementById(\"js\").textContent=\"yes\";</script>",
  "</body></html>",
].join("");

const SCENARIO = JSON.stringify({
  steps: [
    { emit: "text", content: "Authoring and rendering an agent widget:" },
    { mcp_call: "widget_register", args: { name: "agent-card", body: WIDGET_BODY, description: "e2e demo" } },
    // widget_list exercises the registry list path end-to-end (workspace-scoped).
    // widget_update is covered by the gRPC handler tests (it needs an id the stub
    // scenario can't capture). Render resolves the registered widget by name.
    { mcp_call: "widget_list", args: {} },
    { mcp_call: "widget_render", args: { name: "agent-card", props: { demo: true } } },
  ],
});

test.describe("Agent widget registry (#1239)", { tag: ["@persona"] }, () => {
  test("widget_register + widget_render paints the agent-authored widget inline", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // A task spawn gives the session a real workspaceId for the scoped MCP token,
    // which the widget tools require (workspaceId is auto-injected from it).
    const wsId = await createWorkspace(client, "widget-e2e-proj");
    await createTaskDirect(client, wsId, "render agent widget", {
      environmentId: "test-local",
      description: SCENARIO,
    });
    await navigateToTask(page, "render agent widget");
    await patchWsForStubMcpRuntime(page);

    await page.getByTestId("task-header-start").click();

    // Scenario runs register -> render; the render event dispatches to the host renderer.
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mcp-app-widget")).toBeVisible({ timeout: 15_000 });

    // Strong proof: the widget paints inside the cross-origin double-iframe sandbox,
    // and the agent's own inline <script> executed (#js flipped to "yes").
    const widgetFrame = page.frameLocator('[data-testid="mcp-app-widget"]').frameLocator("iframe");
    await expect(widgetFrame.getByText("Agent Widget")).toBeVisible({ timeout: 20_000 });
    await expect(widgetFrame.locator("#js")).toHaveText("yes", { timeout: 20_000 });

    // The registry tools rendered as tool cards too (register + render ran).
    await expect(page.locator('[data-testid^="tool-card-"]').first()).toBeVisible({ timeout: 10_000 });
  });
});
