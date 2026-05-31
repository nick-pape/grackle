import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * End-to-end proof of the live-docs v0 viewer (#1396): a human clicks a filepath
 * in the chat, a read-only document tab opens in the side pane bound to the
 * file's `file://` URI, renders its markdown via the AHP resource bridge (#1395),
 * and live-refreshes when the file changes on disk.
 *
 * The agent-initiated `show_file` path + the `document.show` -> tab routing are
 * covered by unit tests (packages/mcp `show_file`, packages/web `useDocuments`)
 * and Storybook (DocPane render states); this spec exercises the full browser
 * pipeline — clickable path -> openDocument -> bridge read/watch -> render —
 * against a real PowerLine + Server stack.
 *
 * A stub session is spawned sandboxed to a temp dir we own (useWorktrees:false)
 * and scripted to emit a Write tool call referencing the file, so the chat shows
 * a clickable filepath at a deterministic location.
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

      // Open the session view; the Write tool card exposes a clickable filename.
      await page.goto(`/sessions/${sessionId}`);
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
