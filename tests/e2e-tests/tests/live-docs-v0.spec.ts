import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * End-to-end proof of the live-docs v0 viewer (#1396) against a real PowerLine +
 * Server stack. Two tests cover both producer paths:
 *
 * 1. **Human-click path**: a stub session emits a Write tool-call event → the
 *    chat renders a clickable filepath chip → click opens a doc tab → tab renders
 *    markdown via the resource bridge → file rewrite live-refreshes the tab.
 *
 * 2. **Agent show_file path**: a stub-mcp session calls the real `show_file` MCP
 *    tool via the broker → the broker captures the `_meta` descriptor → emits a
 *    `document.show` domain event → the web `useDocuments` hook opens a tab
 *    (no user click, no focus steal). Proves the full integration chain that unit
 *    tests can't cover: tool handler → broker capture → publishDocumentShow →
 *    event-bus → StreamEvents → domain hook → tab render.
 *
 * Both tests spawn a session sandboxed to a temp dir (useWorktrees:false) so
 * PowerLine's allowedRoots covers the test file and URIs are deterministic.
 */
test.describe("Live docs v0 viewer", { tag: ["@session"] }, () => {
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.core.listSessions({});
    const active = (sessionsResp.sessions as Array<{ id: string; status: string }>).filter(
      (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
    );
    for (const s of active) {
      await client.core.killAgent({ id: s.id });
    }
  });

  test("clicking a file path opens a live read-only doc tab that refreshes on change", async ({
    appPage,
    grackle: { client },
  }) => {
    test.setTimeout(60_000);
    const page = appPage;

    const dir = await mkdtemp(join(tmpdir(), "grackle-livedoc-"));
    try {
      const filePath = join(dir, "plan.md");
      await writeFile(filePath, "# Plan v1\n\nFirst draft.\n", "utf-8");
      const fileUri = pathToFileURL(filePath).href;

      // Stub session sandboxed to `dir`, scripted to emit a Write tool call that
      // references the file (so the chat renders a clickable filepath) then idle.
      const scenario = JSON.stringify({
        steps: [
          { emit: "text", content: "Working on the plan." },
          { emit: "tool_use", tool: "Write", args: { file_path: filePath } },
          { emit: "tool_result", content: "wrote plan.md" },
          { idle: true },
        ],
      });
      const spawn = await client.core.spawnAgent({
        environmentId: "test-local",
        prompt: scenario,
        provider: "stub",
        config: {
          personaId: "stub",
          branch: "e2e-livedoc",
          workingDirectory: dir,
          useWorktrees: false,
        },
      });
      const sessionId = spawn.id;
      expect(sessionId).toBeTruthy();

      // Wait for PowerLine to sandbox the session's working tree (the bridge read
      // must succeed when the pane opens; allowedRoots arms in the background).
      await expect(async () => {
        const content = await client.core.readResource({
          environmentId: "test-local",
          uri: fileUri,
          encoding: "",
        });
        expect(content.data).toContain("Plan v1");
      }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

      // Open the session view. The session must be in the sessions list (with a
      // real environmentId, not the placeholder from a status-event upsert) before
      // EventStream wires onOpenDocument. Wait for Stub runtime text then reload
      // once to ensure the full session record (with environmentId) is loaded.
      await page.goto(`/sessions/${sessionId}`);
      await expect(page.getByText("Working on the plan.").first()).toBeVisible({ timeout: 20_000 });
      // Reload forces loadSessions() on reconnect, populating environmentId.
      await page.reload();
      await expect(page.getByText("Working on the plan.").first()).toBeVisible({ timeout: 20_000 });
      const fileLink = page.getByTestId("tool-card-file-link").first();
      await expect(fileLink).toBeVisible({ timeout: 20_000 });

      // Click it -> the doc pane opens with plan.md rendered as markdown.
      await fileLink.click();
      await expect(page.getByTestId("doc-pane")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("doc-markdown")).toContainText("Plan v1", { timeout: 15_000 });
      // Tab labelled by the file's basename.
      await expect(page.getByTestId("doc-tab")).toContainText("plan.md");

      // Rewrite the file -> resource.changed -> the open tab live-refreshes.
      await writeFile(filePath, "# Plan v2 updated\n\nSecond draft.\n", "utf-8");
      await expect(page.getByTestId("doc-markdown")).toContainText("Plan v2 updated", {
        timeout: 20_000,
      });

      await page.screenshot({ path: "test-results/live-docs-human-click.png" });
      await killQuietly(client, sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("show_file MCP tool opens a doc tab via the document.show domain event", async ({
    appPage,
    grackle: { client },
  }) => {
    test.setTimeout(60_000);
    const page = appPage;

    const dir = await mkdtemp(join(tmpdir(), "grackle-showfile-"));
    try {
      const filePath = join(dir, "report.md");
      await writeFile(filePath, "# Agent Report\n\nGenerated content.\n", "utf-8");
      const fileUri = pathToFileURL(filePath).href;

      // Stub-mcp session: idles first so the browser can connect the event
      // stream, then calls show_file when we send input. The domain event is
      // fire-and-forget (not replayed), so the browser MUST be listening before
      // the tool runs.
      const scenario = JSON.stringify({
        steps: [
          { emit: "text", content: "Generating the report." },
          { on_input: "next" },
          { idle: true },
          { mcp_call: "show_file", args: { path: filePath } },
          { emit: "text", content: "Report shown." },
        ],
      });
      const spawn = await client.core.spawnAgent({
        environmentId: "test-local",
        prompt: scenario,
        provider: "stub",
        config: {
          personaId: "stub-mcp",
          branch: "e2e-showfile",
          workingDirectory: dir,
          useWorktrees: false,
        },
      });
      const sessionId = spawn.id;
      expect(sessionId).toBeTruthy();

      // Wait for the sandbox to arm (same pattern as the human-click test).
      await expect(async () => {
        const content = await client.core.readResource({
          environmentId: "test-local",
          uri: fileUri,
          encoding: "",
        });
        expect(content.data).toContain("Agent Report");
      }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

      // Navigate to the session and wait for the stream to connect (the stub
      // idles, so the text event proves the stream is flowing).
      await page.goto(`/sessions/${sessionId}`);
      await expect(page.getByText("Generating the report.").first()).toBeVisible({
        timeout: 20_000,
      });

      // Now send input to resume the stub — it calls show_file, the broker
      // captures the _meta, publishDocumentShow emits the domain event, and the
      // web useDocuments hook (already listening) opens a tab.
      await client.core.sendInput({ sessionId, text: "go" });

      // The doc pane opened from the agent's show_file, not a user click.
      await expect(page.getByTestId("doc-pane")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("doc-markdown")).toContainText("Agent Report", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("doc-tab")).toContainText("report.md");

      await page.screenshot({ path: "test-results/live-docs-agent-show-file.png" });
      await killQuietly(client, sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** Best-effort kill so test teardown never fails on an already-gone session. */
async function killQuietly(client: GrackleClient, sessionId: string): Promise<void> {
  try {
    await client.core.killAgent({ id: sessionId });
  } catch {
    // already terminated
  }
}
