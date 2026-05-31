import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * End-to-end proof of the AHP resource bridge (#1395): the Server, as an AHP
 * client of PowerLine, reads file content and live-watches a file in the
 * session's working tree, surfacing changes as `resource.changed` domain events.
 *
 * This is the bridge's integration proof against a real PowerLine + Server
 * stack, and (under CI's backend-E2E coverage) the consumer that exercises
 * PowerLine's resourceRead/resourceList/createResourceWatch closures.
 *
 * A stub session is spawned with an explicit `workingDirectory` (a temp dir we
 * own) and `useWorktrees: false`, so PowerLine sandboxes resource access to
 * exactly that directory — making the file URIs deterministic.
 */
test.describe("AHP resource bridge", { tag: ["@session"] }, () => {
  // Free the single test-local environment before each test.
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.core.listSessions({});
    const active = (sessionsResp.sessions as Array<{ id: string; status: string }>).filter(
      (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
    );
    for (const s of active) {
      await client.core.killAgent({ id: s.id });
    }
  });

  test("reads file content and streams resource.changed on edit", async ({
    grackle: { client },
  }) => {
    test.setTimeout(60_000);

    // 1. A temp working tree with a known file.
    const dir = await mkdtemp(join(tmpdir(), "grackle-res-"));
    try {
      const filePath = join(dir, "doc.md");
      await writeFile(filePath, "# v1\n", "utf-8");
      const fileUri = pathToFileURL(filePath).href;

      // 2. Spawn a stub session sandboxed to `dir`. A branch is required for the
      // server to forward `workingDirectory`; useWorktrees:false keeps the
      // sandbox root equal to `dir` (no sibling worktree).
      const spawn = await client.core.spawnAgent({
        environmentId: "test-local",
        prompt: "resource bridge e2e",
        provider: "stub",
        config: {
          personaId: "stub",
          branch: "e2e-resource",
          workingDirectory: dir,
          useWorktrees: false,
        },
      });
      const sessionId = spawn.id;
      expect(sessionId).toBeTruthy();

      // 3. ReadResource — poll until the session's working tree is sandboxed
      // (allowedRoots is populated when PowerLine processes createSession,
      // which the server fires in the background after spawn returns).
      await expect(async () => {
        const content = await client.core.readResource({
          environmentId: "test-local",
          uri: fileUri,
          encoding: "",
        });
        expect(content.data).toBe("# v1\n");
        expect(content.encoding).toBe("utf-8");
        expect(content.contentType).toBe("text/markdown");
      }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

      // 4. ListResource sees the file in the directory.
      const listing = await client.core.listResource({
        environmentId: "test-local",
        uri: pathToFileURL(dir).href,
      });
      expect(listing.entries.some((e) => e.name === "doc.md" && e.type === "file")).toBe(true);

      // 5. Watch the file, then start consuming the event stream.
      const watch = await client.core.watchResource({
        environmentId: "test-local",
        uri: fileUri,
        recursive: false,
      });
      expect(watch.watchId).toBeTruthy();

      const abort = new AbortController();
      const changeSeen = (async (): Promise<boolean> => {
        for await (const ev of client.core.streamEvents({}, { signal: abort.signal })) {
          if (ev.event.case !== "domainEvent") {
            continue;
          }
          if (ev.event.value.type !== "resource.changed") {
            continue;
          }
          const payload = JSON.parse(ev.event.value.payloadJson) as {
            environmentId?: string;
            changes?: Array<{ uri?: string }>;
          };
          if (
            payload.environmentId === "test-local" &&
            (payload.changes ?? []).some((c) => c.uri === fileUri)
          ) {
            return true;
          }
        }
        return false;
      })();

      // 6. Mutate the file → PowerLine's chokidar watcher fires → coalesced
      // resourceWatch/changed → Server emits resource.changed.
      await new Promise((r) => setTimeout(r, 500)); // let the watcher arm
      await writeFile(filePath, "# v2\n", "utf-8");

      const sawChange = await Promise.race([
        changeSeen,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000)),
      ]);
      abort.abort();
      expect(sawChange).toBe(true);

      // 7. The fresh content is now readable.
      const after = await client.core.readResource({
        environmentId: "test-local",
        uri: fileUri,
        encoding: "",
      });
      expect(after.data).toBe("# v2\n");

      // 8. Release the watch and the session.
      await client.core.unwatchResource({ watchId: watch.watchId });
      if (sessionId) {
        await killQuietly(client, sessionId);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects reading a file outside the session sandbox", async ({ grackle: { client } }) => {
    test.setTimeout(40_000);
    const dir = await mkdtemp(join(tmpdir(), "grackle-res-"));
    const outside = await mkdtemp(join(tmpdir(), "grackle-out-"));
    try {
      await writeFile(join(dir, "doc.md"), "in", "utf-8");
      await writeFile(join(outside, "secret.txt"), "out", "utf-8");
      const spawn = await client.core.spawnAgent({
        environmentId: "test-local",
        prompt: "sandbox e2e",
        provider: "stub",
        config: {
          personaId: "stub",
          branch: "e2e-sandbox",
          workingDirectory: dir,
          useWorktrees: false,
        },
      });

      // Wait until the sandbox is active (in-sandbox read succeeds).
      await expect(async () => {
        await client.core.readResource({
          environmentId: "test-local",
          uri: pathToFileURL(join(dir, "doc.md")).href,
          encoding: "",
        });
      }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

      // A read outside the sandbox is denied.
      await expect(
        client.core.readResource({
          environmentId: "test-local",
          uri: pathToFileURL(join(outside, "secret.txt")).href,
          encoding: "",
        }),
      ).rejects.toThrow(/permission|denied/i);

      if (spawn.id) {
        await killQuietly(client, spawn.id);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
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
