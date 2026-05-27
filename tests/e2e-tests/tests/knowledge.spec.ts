import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";
import { createWorkspace, createTaskDirect, stubScenario, emitText } from "./helpers.js";

/**
 * Knowledge Graph E2E tests.
 *
 * These tests require the knowledge graph subsystem (embedding model) to be
 * available on the server. In CI the embedder is typically absent without
 * the Neo4j service container, so each test probes availability first and
 * skips gracefully if the backend returns UNAVAILABLE.
 */
test.describe("Knowledge Graph", { tag: ["@webui"] }, () => {
  /** Probe knowledge availability via SearchKnowledge RPC. Skip if unavailable. */
  async function skipIfKnowledgeUnavailable(
    client: ReturnType<typeof import("./rpc-client.js").createTestClient>,
  ): Promise<void> {
    try {
      await client.knowledge.searchKnowledge({ query: "probe", limit: 1 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("not available") ||
        message.includes("Unavailable") ||
        message.includes("unavailable")
      ) {
        test.skip(true, "Knowledge graph not available in this environment");
      }
      throw error;
    }
  }

  /** Navigate to the Knowledge tab and wait for the page to load. */
  async function navigateToKnowledge(page: Page): Promise<void> {
    await page.locator('[data-testid="sidebar-tab-knowledge"]').click();
    await page.locator('[data-testid="knowledge-page"]').waitFor({ timeout: 5_000 });
  }

  test("knowledge page renders and shows graph container", async ({
    appPage,
    grackle: { client },
  }) => {
    await skipIfKnowledgeUnavailable(client);
    await navigateToKnowledge(appPage);

    // The knowledge page should render with the nav and graph containers
    await expect(appPage.locator('[data-testid="knowledge-nav"]')).toBeVisible({ timeout: 5_000 });
  });

  test("derived mirror projects entities, structural edges, and is idempotent", async ({
    grackle: { client },
  }) => {
    await skipIfKnowledgeUnavailable(client);

    // Create a workspace + parent/child tasks. Their create events drive the
    // entity-sync subscriber, which projects reference nodes (+ structural
    // edges) into Neo4j — no embedding needed for structural projection.
    const marker = `kgproj-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    // Parent needs decomposition rights to allow a child task.
    const parent = await createTaskDirect(client, wsId, `${marker}-parent`, { canDecompose: true });
    const parentId = (parent as unknown as { id: string }).id;
    const child = await createTaskDirect(client, wsId, `${marker}-child`, {
      parentTaskId: parentId,
    });
    const childId = (child as unknown as { id: string }).id;

    // 1) Nodes project. listRecentKnowledgeNodes needs no embeddings, so this is
    //    deterministic (no embed-backfill wait): workspace + both task nodes.
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          return result.nodes.filter((node) => node.label?.includes(marker)).length;
        },
        { timeout: 20_000, message: "workspace + task nodes should be projected into the KG" },
      )
      .toBeGreaterThanOrEqual(3);

    // 2) Structural edges: expanding the child reaches its parent (PART_OF) and
    //    its workspace (IN_WORKSPACE), proving FK→edge projection + traversal.
    //    Edges are projected just after their nodes, so poll the traversal until
    //    they land (avoids racing the subscriber).
    await expect
      .poll(
        async () => {
          const recent = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          const childNode = recent.nodes.find(
            (node) => node.sourceType === "task" && node.sourceId === childId,
          );
          if (!childNode) {
            return [];
          }
          const expanded = await client.knowledge.expandKnowledgeNode({
            id: childNode.id,
            depth: 1,
          });
          return expanded.nodes.map((node) => `${node.sourceType}:${node.sourceId}`);
        },
        {
          timeout: 20_000,
          message: "child should reach its parent (PART_OF) and workspace (IN_WORKSPACE)",
        },
      )
      .toEqual(expect.arrayContaining([`task:${parentId}`, `workspace:${wsId}`]));

    // 3) Idempotency: re-projecting the parent (via an update event) updates the
    //    node in place — MERGE keyed on (sourceType, sourceId) never duplicates.
    const p = parent as unknown as { description: string; status: number };
    await client.orchestration.updateTask({
      id: parentId,
      title: `${marker}-parent-v2`,
      description: p.description,
      status: p.status,
      dependsOn: [],
    });
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          const parentNodes = result.nodes.filter(
            (node) => node.sourceType === "task" && node.sourceId === parentId,
          );
          return parentNodes.length === 1 && (parentNodes[0].label?.includes("parent-v2") ?? false);
        },
        {
          timeout: 20_000,
          message: "re-projection must update in place, not create a duplicate node",
        },
      )
      .toBe(true);
  });

  test("deleting an entity prunes its mirror node", async ({ grackle: { client } }) => {
    await skipIfKnowledgeUnavailable(client);

    // Project a task, then delete it: the entity-sync subscriber unprojects it and
    // the reconciliation scan prunes any orphan — exercising DETACH DELETE / prune
    // against real Neo4j (otherwise only mock-tested).
    const marker = `kgprune-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    const task = await createTaskDirect(client, wsId, `${marker}-task`);
    const taskId = (task as unknown as { id: string }).id;

    await expect
      .poll(
        async () => {
          const r = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          return r.nodes.some((n) => n.sourceType === "task" && n.sourceId === taskId);
        },
        { timeout: 20_000, message: "task node should project before deletion" },
      )
      .toBe(true);

    await client.orchestration.deleteTask({ id: taskId });

    await expect
      .poll(
        async () => {
          const r = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          return r.nodes.some((n) => n.sourceType === "task" && n.sourceId === taskId);
        },
        { timeout: 20_000, message: "deleted task's mirror node should be pruned" },
      )
      .toBe(false);
  });

  test("workspace LINKED_TO its environment projects as a structural edge", async ({
    grackle: { client },
  }) => {
    await skipIfKnowledgeUnavailable(client);

    // createWorkspace links the workspace to test-local, so a LINKED_TO edge from
    // the workspace node to the environment node must project + be traversable.
    // (The link-set-in-hash convergence is covered by mappers.test.ts; the
    // removeOutgoingEdges reconcile by the knowledge-core integration suite.
    // Unlinking is not asserted here because the server forbids removing a
    // workspace's last environment.)
    const marker = `kglink-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);

    await expect
      .poll(
        async () => {
          const recent = await client.knowledge.listRecentKnowledgeNodes({ limit: 200 });
          const wsNode = recent.nodes.find(
            (n) => n.sourceType === "workspace" && n.sourceId === wsId,
          );
          if (!wsNode) {
            return [];
          }
          const expanded = await client.knowledge.expandKnowledgeNode({ id: wsNode.id, depth: 1 });
          return expanded.nodes.map((n) => `${n.sourceType}:${n.sourceId}`);
        },
        { timeout: 25_000, message: "workspace should LINK_TO its environment" },
      )
      .toEqual(expect.arrayContaining(["environment:test-local"]));
  });

  test("re-projection converges (stable node count across reconciliation ticks)", async ({
    grackle: { client },
  }) => {
    await skipIfKnowledgeUnavailable(client);

    // MERGE-keyed projection must be idempotent: repeated reconciliation ticks
    // never duplicate a node. This is the end-to-end substance of rebuild()
    // idempotency (which has no RPC trigger by design).
    const marker = `kgconv-${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    await createTaskDirect(client, wsId, `${marker}-a`);
    await createTaskDirect(client, wsId, `${marker}-b`);

    const countMarkerNodes = async (): Promise<number> => {
      const r = await client.knowledge.listRecentKnowledgeNodes({ limit: 500 });
      return r.nodes.filter((n) => n.label?.includes(marker)).length;
    };

    // workspace + both task nodes.
    await expect
      .poll(countMarkerNodes, { timeout: 20_000, message: "marker entities should project" })
      .toBeGreaterThanOrEqual(3);

    const first = await countMarkerNodes();
    // Span multiple reconciliation ticks (2s each in e2e); a non-idempotent MERGE
    // would grow the count here.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(await countMarkerNodes()).toBe(first);
  });

  test("transcript chunks are chunked, embedded, and semantically searchable", async ({
    stubTask,
  }) => {
    // Sessions/transcripts are reconciliation-driven (not event-driven), so this
    // waits for a reconciliation tick + local embedding — beyond the default 30s.
    test.setTimeout(90_000);
    const { page, client } = stubTask;
    await skipIfKnowledgeUnavailable(client);

    // Run a stub session that emits a recognizable line into its transcript.
    const marker = `KGMARKER-${Date.now()}`;
    await stubTask.createAndNavigate(
      "kg-transcript",
      stubScenario(
        emitText(`The deployment pipeline uses blue-green rollouts. Reference token ${marker}.`),
      ),
    );
    // Just start the task — the stub emits the line into the session's
    // stream.jsonl on spawn. (No need to drive the chat to completion; the
    // reconciliation phase chunks the transcript regardless of session status.)
    const startButton = page.getByTestId("task-header-start");
    await startButton.waitFor({ timeout: 15_000 });
    await startButton.click();

    // The reconciliation phase projects the session, chunks the transcript, and
    // embeds the chunks inline — so a semantic query should return the chunk
    // (verified by the unique marker in its content). Generous timeout: this
    // waits for a phase tick + local embedding.
    await expect
      .poll(
        async () => {
          const result = await client.knowledge.searchKnowledge({
            // Semantic terms + the unique marker: keeps the test exercising the
            // embed→vector-search path while ensuring the target chunk ranks in
            // the top results regardless of what else is in the graph.
            query: `deployment pipeline blue-green rollout ${marker}`,
            limit: 10,
          });
          return result.results.some((hit) => hit.node?.content?.includes(marker));
        },
        {
          timeout: 45_000,
          message: "transcript chunk should be chunked, embedded, and searchable",
        },
      )
      .toBe(true);
  });

  test("updating an entity refreshes its embedding so search reflects the new text", async ({
    grackle: { client },
  }) => {
    // Entity embeddings are backfilled off the write path, then must be
    // invalidated + recomputed when the projected text changes — otherwise
    // semantic search stays stale. Waits for two backfill cycles → > default 30s.
    test.setTimeout(90_000);
    await skipIfKnowledgeUnavailable(client);

    const oldMarker = `quokka${Date.now()}`;
    const newMarker = `pangolin${Date.now()}`;
    const wsId = await createWorkspace(client, `embedrefresh-ws-${Date.now()}`);
    const task = await createTaskDirect(
      client,
      wsId,
      `Investigate ${oldMarker} migration patterns`,
    );
    const taskId = (task as unknown as { id: string }).id;

    const searchHitsTask = async (query: string): Promise<boolean> => {
      const r = await client.knowledge.searchKnowledge({ query, limit: 20 });
      return r.results.some(
        (hit) => hit.node?.sourceType === "task" && hit.node?.sourceId === taskId,
      );
    };

    // Backfill embeds the new task node → findable by its original term.
    await expect
      .poll(() => searchHitsTask(`${oldMarker} migration`), {
        timeout: 45_000,
        message: "task should be searchable by its original distinctive term",
      })
      .toBe(true);

    // Rename to a semantically distinct term.
    const t = task as unknown as { description: string; status: number };
    await client.orchestration.updateTask({
      id: taskId,
      title: `Investigate ${newMarker} migration patterns`,
      description: t.description,
      status: t.status,
      dependsOn: [],
    });

    // The hash changed → upsertEntityNode cleared the stale embedding → backfill
    // recomputes it → the task becomes findable by the NEW term.
    await expect
      .poll(() => searchHitsTask(`${newMarker} migration`), {
        timeout: 45_000,
        message: "renamed task should be searchable by its new term (embedding refreshed)",
      })
      .toBe(true);
  });

  // ── Retrieval loop (#1259): spawn-time "Related prior work" injection ──

  type TestClient = ReturnType<typeof import("./rpc-client.js").createTestClient>;

  /** Start a task with the stub runtime and return its session ID. */
  async function startTaskStub(client: TestClient, taskId: string): Promise<string> {
    const resp = await client.orchestration.startTask({
      taskId,
      personaId: "stub",
      environmentId: "test-local",
    });
    if (!resp.id) {
      throw new Error(`No session ID from startTask for ${taskId}`);
    }
    return resp.id;
  }

  /** Poll a session's events for the systemContext (first SYSTEM event) and return its content. */
  async function pollSystemContext(
    client: TestClient,
    sessionId: string,
    timeoutMs = 30_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const resp = await client.core.getSessionEvents({ id: sessionId });
      for (const event of resp.events ?? []) {
        if (typeof event.content === "string" && event.raw) {
          try {
            const raw = JSON.parse(event.raw) as Record<string, unknown>;
            if (raw.systemContext === true) {
              return event.content;
            }
          } catch {
            // not JSON — skip
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`No systemContext event for session ${sessionId} within ${timeoutMs}ms`);
  }

  test("spawn injects Related prior work from the knowledge graph", async ({
    grackle: { client },
  }) => {
    test.setTimeout(120_000);
    await skipIfKnowledgeUnavailable(client);

    const marker = `kgloop${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);

    // A prior task in the workspace whose label the spawn push should surface.
    await createTaskDirect(
      client,
      wsId,
      `Implement OAuth2 authentication with refresh tokens ${marker}`,
      {
        description: "JWT access tokens with refresh-token rotation",
      },
    );
    // Wait until it is embedded + searchable (entity embeddings backfill asynchronously).
    await expect
      .poll(
        async () => {
          const r = await client.knowledge.searchKnowledge({
            query: `OAuth2 authentication refresh tokens ${marker}`,
            limit: 10,
          });
          return r.results.some((hit) => hit.node?.label?.includes(marker));
        },
        { timeout: 90_000, message: "prior task should become searchable" },
      )
      .toBe(true);

    // A new, related task (injectKnowledge defaults ON). Its own unique token must be
    // self-excluded from the injected block.
    const newTask = await createTaskDirect(
      client,
      wsId,
      `Add ratelimit${marker} guard to the OAuth2 authentication endpoints`,
      { description: "Throttle the auth endpoints" },
    );
    const sessionId = await startTaskStub(client, (newTask as unknown as { id: string }).id);

    const systemContext = await pollSystemContext(client, sessionId);
    expect(systemContext).toContain("## Related prior work");
    expect(systemContext).toContain(marker); // prior task surfaced
    expect(systemContext).toContain("knowledge_search"); // PULL guidance present
    expect(systemContext).not.toContain(`ratelimit${marker}`); // self-exclusion
  });

  test("a task with injectKnowledge disabled gets no Related prior work block", async ({
    grackle: { client },
  }) => {
    test.setTimeout(120_000);
    await skipIfKnowledgeUnavailable(client);

    const marker = `kgoff${Date.now()}`;
    const wsId = await createWorkspace(client, `${marker}-ws`);
    await createTaskDirect(client, wsId, `Implement OAuth2 authentication ${marker}`, {});
    await expect
      .poll(
        async () => {
          const r = await client.knowledge.searchKnowledge({
            query: `OAuth2 authentication ${marker}`,
            limit: 10,
          });
          return r.results.some((hit) => hit.node?.label?.includes(marker));
        },
        { timeout: 90_000, message: "prior task should become searchable" },
      )
      .toBe(true);

    // Opted out → no injection even though relevant prior work exists.
    const off = await createTaskDirect(client, wsId, `Refactor OAuth2 token handling ${marker}`, {
      injectKnowledge: false,
    });
    const sessionId = await startTaskStub(client, (off as unknown as { id: string }).id);
    const systemContext = await pollSystemContext(client, sessionId);
    expect(systemContext).not.toContain("## Related prior work");
  });
});
