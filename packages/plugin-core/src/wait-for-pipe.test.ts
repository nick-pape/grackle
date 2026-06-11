/**
 * Unit/integration tests for waitForPipe and getSessionFds.
 *
 * Uses the real in-memory stream registry and pipe-delivery (not mocked), so
 * the sync-consume path fires correctly.  The database uses a real in-memory
 * SQLite via setupTestDatabase() — do NOT add a vi.mock for @grackle-ai/database.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { streamRegistry, pipeDelivery } from "@grackle-ai/core";
import { setupTestDatabase } from "@grackle-ai/test-utils/db";
import { waitForPipe, getSessionFds } from "./pipe-handlers.js";

// ── Real in-memory SQLite ─────────────────────────────────────────────────────
// Neither waitForPipe nor getSessionFds calls the DB, but importing pipe-handlers
// loads sessionStore; setupTestDatabase() initialises the connection so the module
// loads cleanly and any store-spy assertions work.
const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ─────────────────────────────────────────────────────────────────────────────
// waitForPipe
// ─────────────────────────────────────────────────────────────────────────────

describe("waitForPipe", () => {
  let cleanupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    streamRegistry._resetForTesting();
    pipeDelivery._resetForTesting();
    vi.clearAllMocks();
    // Passthrough spy — exercises real cleanup AND records arguments.
    cleanupSpy = vi.spyOn(pipeDelivery, "cleanupSyncPipeAndLifecycle");
  });

  it("throws NotFound when no subscription exists for (sessionId, fd)", async () => {
    await expect(
      waitForPipe(create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: 5 })),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("throws FailedPrecondition when the subscription is not a sync subscription (async mode)", async () => {
    const stream = streamRegistry.createStream("pipe:child");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);

    await expect(
      waitForPipe(
        create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: parentSub.fd }),
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition });
  });

  it("resolves with the message content and senderSessionId (happy path)", async () => {
    const stream = streamRegistry.createStream("pipe:child");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
    streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

    // Start waitForPipe — it blocks on consumeSync.
    const waitPromise = waitForPipe(
      create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: parentSub.fd }),
    );

    // Publish from the child — this enqueues the message on the parent's sync queue,
    // unblocking consumeSync.
    streamRegistry.publish(stream.id, "child", "hello from child");

    const result = await waitPromise;
    expect(result.content).toBe("hello from child");
    expect(result.senderSessionId).toBe("child");
  });

  it("calls cleanupSyncPipeAndLifecycle in the finally block after success", async () => {
    const stream = streamRegistry.createStream("pipe:sess-abc");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
    streamRegistry.subscribe(stream.id, "sess-abc", "rw", "async", false);

    const waitPromise = waitForPipe(
      create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: parentSub.fd }),
    );
    streamRegistry.publish(stream.id, "sess-abc", "done");
    await waitPromise;

    // childSessionId is derived from the stream name "pipe:sess-abc" → "sess-abc".
    expect(cleanupSpy).toHaveBeenCalledWith(stream.id, "sess-abc");
  });

  it("calls cleanupSyncPipeAndLifecycle even when consumeSync is cancelled (finally path)", async () => {
    // Named "pipe:sess-xyz" so childSessionId is resolved from the name.
    const stream = streamRegistry.createStream("pipe:sess-xyz");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
    const capturedStreamId = stream.id;

    const waitPromise = waitForPipe(
      create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: parentSub.fd }),
    );

    // Closing the subscription rejects the pending consumeSync ("Subscription closed").
    streamRegistry.unsubscribe(parentSub.id);

    // waitForPipe should reject, but the finally block still ran.
    await expect(waitPromise).rejects.toBeDefined();

    // childSessionId is "sess-xyz" (derived from "pipe:sess-xyz" at handler entry time,
    // before consumeSync blocked).
    expect(cleanupSpy).toHaveBeenCalledWith(capturedStreamId, "sess-xyz");
  });

  it("passes childSessionId=undefined for non-pipe stream names (cancellation path)", async () => {
    // A global (non-pipe) stream — childSessionId cannot be derived from the name.
    const stream = streamRegistry.createStream("global-channel");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
    const capturedStreamId = stream.id;

    const waitPromise = waitForPipe(
      create(grackle.WaitForPipeRequestSchema, { sessionId: "parent", fd: parentSub.fd }),
    );

    streamRegistry.unsubscribe(parentSub.id);
    await expect(waitPromise).rejects.toBeDefined();

    expect(cleanupSpy).toHaveBeenCalledWith(capturedStreamId, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSessionFds
// ─────────────────────────────────────────────────────────────────────────────

describe("getSessionFds", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
  });

  it("returns an empty fds array when the session has no subscriptions", () => {
    const result = getSessionFds(create(grackle.SessionIdSchema, { id: "ghost" }));
    expect(result.fds).toEqual([]);
  });

  it("returns one FdInfo with correct field values", () => {
    const stream = streamRegistry.createStream("pipe:child");
    const sub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);

    const result = getSessionFds(create(grackle.SessionIdSchema, { id: "parent" }));

    expect(result.fds).toHaveLength(1);
    const fd = result.fds[0];
    expect(fd.fd).toBe(sub.fd);
    expect(fd.streamName).toBe("pipe:child");
    expect(fd.permission).toBe("rw");
    expect(fd.deliveryMode).toBe("sync");
    expect(fd.owned).toBe(true); // createdBySpawn=true
  });

  it("resolves targetSessionId to the other participant on a shared stream", () => {
    const stream = streamRegistry.createStream("pipe:child");
    streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
    streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

    const result = getSessionFds(create(grackle.SessionIdSchema, { id: "parent" }));

    expect(result.fds[0].targetSessionId).toBe("child");
  });

  it("returns targetSessionId as empty string when the session is the sole subscriber", () => {
    const stream = streamRegistry.createStream("solo-stream");
    streamRegistry.subscribe(stream.id, "lone-agent", "rw", "async", false);

    const result = getSessionFds(create(grackle.SessionIdSchema, { id: "lone-agent" }));

    expect(result.fds[0].targetSessionId).toBe("");
  });

  it("returns multiple FdInfos when the session holds subscriptions on multiple streams", () => {
    const streamA = streamRegistry.createStream("pipe:child-a");
    const streamB = streamRegistry.createStream("pipe:child-b");
    streamRegistry.subscribe(streamA.id, "parent", "rw", "sync", true);
    streamRegistry.subscribe(streamB.id, "parent", "r", "async", true);

    const result = getSessionFds(create(grackle.SessionIdSchema, { id: "parent" }));

    expect(result.fds).toHaveLength(2);
    const names = result.fds.map((f) => f.streamName).sort();
    expect(names).toEqual(["pipe:child-a", "pipe:child-b"]);
  });
});
