/**
 * Integration tests for writeToFd and closeFd with async delivery tracking.
 *
 * Uses the real stream-registry and pipe-delivery (not mocked), so the full chain fires:
 *   writeToFd → publish() → async listener → gRPC sendInput → deliveredTo tracking
 *   → awaitPendingDeliveries → delivery verification
 *
 * Only the database (sessionStore.getSession) and the adapter connection are stubbed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { streamRegistry, pipeDelivery, adapterManager } from "@grackle-ai/core";
import { sessionStore } from "@grackle-ai/database";
import { writeToFd, closeFd } from "./session-handlers.js";

// Mock the database — only sessionStore.getSession is needed; everything else is unreachable
// by writeToFd/closeFd and can stay as vi.fn() stubs.
vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

/** Minimal session shape used by the pipe-delivery async listener. */
const makeSession = (id: string, environmentId = "test-env") => ({
  id,
  environmentId,
  parentSessionId: "",
  pipeMode: "",
  status: "running",
  logPath: null,
  error: null,
});

describe("writeToFd + closeFd — async delivery integration", () => {
  let mockSendInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    streamRegistry._resetForTesting();
    pipeDelivery._resetForTesting();
    vi.clearAllMocks();

    mockSendInput = vi.fn().mockResolvedValue({});

    // Inject a controllable sendInput so the real pipe-delivery async listener can fire.
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { sendInput: mockSendInput },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);

    // Make sessionStore.getSession return a valid session so the listener doesn't throw.
    vi.mocked(sessionStore.getSession).mockImplementation((id: string) =>
      makeSession(id) as unknown as ReturnType<typeof sessionStore.getSession>,
    );
  });

  /**
   * Create a pipe stream with one writer ("child", rw/async) and one async reader ("parent",
   * rw/async). Registers the async delivery listener for "parent" so that when "child"
   * publishes, sendInput is called for "parent".
   */
  function setupPipeStream(): { streamId: string; parentFd: number; childFd: number } {
    const stream = streamRegistry.createStream("pipe:child");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
    const childSub = streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
    pipeDelivery.ensureAsyncDeliveryListener("parent");
    return { streamId: stream.id, parentFd: parentSub.fd, childFd: childSub.fd };
  }

  // ─── writeToFd ────────────────────────────────────────────────────────────────

  describe("writeToFd", () => {
    it("returns Empty when sendInput resolves (happy path)", async () => {
      const { childFd } = setupPipeStream();

      const result = await writeToFd(
        create(grackle.WriteToFdRequestSchema, {
          sessionId: "child",
          fd: childFd,
          message: "hello from child",
        }),
      );

      expect(result).toBeDefined();
      expect(mockSendInput).toHaveBeenCalledOnce();
      // sendInput is called for the parent (the async reader), not the sender
      expect(mockSendInput.mock.calls[0][0].sessionId).toBe("parent");
    });

    it("throws ConnectError(FailedPrecondition) when sendInput rejects", async () => {
      const { childFd } = setupPipeStream();
      mockSendInput.mockRejectedValue(new Error("gRPC transport failure"));

      let caughtErr: unknown;
      try {
        await writeToFd(
          create(grackle.WriteToFdRequestSchema, {
            sessionId: "child",
            fd: childFd,
            message: "hello from child",
          }),
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConnectError);
      expect((caughtErr as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((caughtErr as ConnectError).message).toContain("delivery failed");
    });

    it("throws when one of two async readers has no listener (partial delivery)", async () => {
      // Two readers: "reader-a" has a listener (sendInput resolves),
      // "reader-b" has no listener (message stays undelivered).
      const stream = streamRegistry.createStream("pipe:multi");
      streamRegistry.subscribe(stream.id, "reader-a", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "reader-b", "rw", "async", true);
      const writerSub = streamRegistry.subscribe(stream.id, "writer", "w", "detach", false);
      pipeDelivery.ensureAsyncDeliveryListener("reader-a");
      // Intentionally no listener for "reader-b"

      let caughtErr: unknown;
      try {
        await writeToFd(
          create(grackle.WriteToFdRequestSchema, {
            sessionId: "writer",
            fd: writerSub.fd,
            message: "broadcast",
          }),
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConnectError);
      expect((caughtErr as ConnectError).code).toBe(Code.FailedPrecondition);
    });

    it("returns Empty when there are no async subscribers (sync-only stream)", async () => {
      // Only a sync reader — no async delivery to verify, writeToFd should succeed.
      const stream = streamRegistry.createStream("pipe:sync-only");
      streamRegistry.subscribe(stream.id, "reader", "rw", "sync", true);
      const writerSub = streamRegistry.subscribe(stream.id, "writer", "w", "detach", false);

      const result = await writeToFd(
        create(grackle.WriteToFdRequestSchema, {
          sessionId: "writer",
          fd: writerSub.fd,
          message: "hello",
        }),
      );

      expect(result).toBeDefined();
      expect(mockSendInput).not.toHaveBeenCalled();
    });
  });

  // ─── closeFd ─────────────────────────────────────────────────────────────────

  describe("closeFd", () => {
    it("succeeds when all messages have been delivered", async () => {
      const { parentFd, childFd } = setupPipeStream();

      // Child writes; sendInput for parent resolves → message delivered to parent
      await writeToFd(
        create(grackle.WriteToFdRequestSchema, {
          sessionId: "child",
          fd: childFd,
          message: "final message",
        }),
      );

      // Parent can now close its fd — hasUndeliveredMessages should be false
      const result = await closeFd(
        create(grackle.CloseFdRequestSchema, {
          sessionId: "parent",
          fd: parentFd,
        }),
      );

      expect(result).toBeDefined();
    });

    it("throws ConnectError(FailedPrecondition) when undelivered messages exist", async () => {
      const { parentFd } = setupPipeStream();
      mockSendInput.mockRejectedValue(new Error("gRPC failure"));

      // Publish directly — sendInput rejects → parent sub stays undelivered
      const stream = streamRegistry.getStreamByName("pipe:child")!;
      const msg = streamRegistry.publish(stream.id, "child", "message that won't arrive");

      // Wait for all pending delivery Promises to settle (deterministic — no setTimeout).
      // awaitPendingDeliveries uses Promise.all on the same deliveryPromise array, so it
      // returns once the sendInput rejection has propagated through the .then(ok, fail)
      // handler and deliveredTo has been left unpopulated.
      await streamRegistry.awaitPendingDeliveries(msg);

      let caughtErr: unknown;
      try {
        await closeFd(
          create(grackle.CloseFdRequestSchema, {
            sessionId: "parent",
            fd: parentFd,
          }),
        );
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ConnectError);
      expect((caughtErr as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((caughtErr as ConnectError).message).toContain("undelivered messages");
    });
  });
});
