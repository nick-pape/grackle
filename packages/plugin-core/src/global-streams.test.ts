import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { streamRegistry, pipeDelivery } from "@grackle-ai/core";
import { createStream, attachStream } from "./session-handlers.js";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

// Spy on pipeDelivery to verify async listener registration
vi.spyOn(pipeDelivery, "ensureAsyncDeliveryListener").mockImplementation(() => vi.fn());

describe("createStream", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.mocked(pipeDelivery.ensureAsyncDeliveryListener).mockClear();
  });

  it("creates a stream and returns streamId + fd", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "my-channel",
    });

    const res = await createStream(req);

    expect(res.streamId).toBeTruthy();
    expect(res.fd).toBeGreaterThanOrEqual(3);
  });

  it("creator gets rw/async subscription", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "test-stream",
    });

    const res = await createStream(req);

    const sub = streamRegistry.getSubscription("session-1", res.fd);
    expect(sub).toBeDefined();
    expect(sub!.permission).toBe("rw");
    expect(sub!.deliveryMode).toBe("async");
    expect(sub!.createdBySpawn).toBe(false);
  });

  it("registers async delivery listener for creator", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "test-stream",
    });

    await createStream(req);

    expect(pipeDelivery.ensureAsyncDeliveryListener).toHaveBeenCalledWith("session-1");
  });

  it("stream name is stored for debugging", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "debug-label",
    });

    const res = await createStream(req);

    const stream = streamRegistry.getStream(res.streamId);
    expect(stream).toBeDefined();
    expect(stream!.name).toBe("debug-label");
  });

  it("throws on duplicate stream name", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "unique-name",
    });

    await createStream(req);

    await expect(createStream(req)).rejects.toThrow(ConnectError);
    try {
      await createStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.AlreadyExists);
    }
  });

  it("throws on missing sessionId", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "",
      name: "test",
    });

    await expect(createStream(req)).rejects.toThrow(ConnectError);
    try {
      await createStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it("rejects reserved stream name prefixes", async () => {
    for (const name of ["lifecycle:foo", "pipe:bar"]) {
      const req = create(grackle.CreateStreamRequestSchema, {
        sessionId: "session-1",
        name,
      });

      await expect(createStream(req)).rejects.toThrow(ConnectError);
      try {
        await createStream(req);
      } catch (err) {
        expect((err as ConnectError).code).toBe(Code.InvalidArgument);
      }
    }
  });

  it("throws on missing name", async () => {
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "session-1",
      name: "",
    });

    await expect(createStream(req)).rejects.toThrow(ConnectError);
    try {
      await createStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });
});

describe("attachStream", () => {
  let streamId: string;
  let creatorFd: number;

  beforeEach(async () => {
    streamRegistry._resetForTesting();
    vi.mocked(pipeDelivery.ensureAsyncDeliveryListener).mockClear();

    // Create a stream as setup for attach tests
    const req = create(grackle.CreateStreamRequestSchema, {
      sessionId: "creator",
      name: "shared-channel",
    });
    const res = await createStream(req);
    streamId = res.streamId;
    creatorFd = res.fd;
  });

  it("attaches target session with requested permission and deliveryMode", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "rw",
      deliveryMode: "async",
    });

    const res = await attachStream(req);

    expect(res.fd).toBeGreaterThanOrEqual(3);
    const sub = streamRegistry.getSubscription("target-1", res.fd);
    expect(sub).toBeDefined();
    expect(sub!.permission).toBe("rw");
    expect(sub!.deliveryMode).toBe("async");
  });

  it("registers async delivery listener for target when deliveryMode is async", async () => {
    vi.mocked(pipeDelivery.ensureAsyncDeliveryListener).mockClear();

    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "rw",
      deliveryMode: "async",
    });

    await attachStream(req);

    expect(pipeDelivery.ensureAsyncDeliveryListener).toHaveBeenCalledWith("target-1");
  });

  it("does NOT register async listener for non-async delivery modes", async () => {
    vi.mocked(pipeDelivery.ensureAsyncDeliveryListener).mockClear();

    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "r",
      deliveryMode: "detach",
    });

    await attachStream(req);

    expect(pipeDelivery.ensureAsyncDeliveryListener).not.toHaveBeenCalledWith("target-1");
  });

  it("allows permission downgrade (caller rw, grant r)", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "r",
      deliveryMode: "async",
    });

    const res = await attachStream(req);

    const sub = streamRegistry.getSubscription("target-1", res.fd);
    expect(sub!.permission).toBe("r");
  });

  it("rejects permission upgrade (caller r, grant rw)", async () => {
    // First, create a read-only subscription for a middleman
    const readOnlyFd = streamRegistry.subscribe(streamId, "middleman", "r", "async", false).fd;

    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "middleman",
      fd: readOnlyFd,
      targetSessionId: "target-1",
      permission: "rw",
      deliveryMode: "async",
    });

    await expect(attachStream(req)).rejects.toThrow(ConnectError);
    try {
      await attachStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.PermissionDenied);
    }
  });

  it("throws when caller has no subscription on the fd", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: 999,
      targetSessionId: "target-1",
      permission: "rw",
      deliveryMode: "async",
    });

    await expect(attachStream(req)).rejects.toThrow(ConnectError);
    try {
      await attachStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.NotFound);
    }
  });

  it("rejects write-only permission with non-detach delivery mode", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "w",
      deliveryMode: "async",
    });

    await expect(attachStream(req)).rejects.toThrow(ConnectError);
    try {
      await attachStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it("allows write-only permission with detach delivery mode", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "w",
      deliveryMode: "detach",
    });

    const res = await attachStream(req);
    expect(res.fd).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid permission string", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "target-1",
      permission: "x",
      deliveryMode: "async",
    });

    await expect(attachStream(req)).rejects.toThrow(ConnectError);
    try {
      await attachStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it("throws on missing targetSessionId", async () => {
    const req = create(grackle.AttachStreamRequestSchema, {
      sessionId: "creator",
      fd: creatorFd,
      targetSessionId: "",
      permission: "rw",
      deliveryMode: "async",
    });

    await expect(attachStream(req)).rejects.toThrow(ConnectError);
    try {
      await attachStream(req);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });
});

describe("createStream + attachStream integration", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
    vi.mocked(pipeDelivery.ensureAsyncDeliveryListener).mockClear();
  });

  it("messages flow from creator to attached target", async () => {
    // Create stream
    const createReq = create(grackle.CreateStreamRequestSchema, {
      sessionId: "alice",
      name: "chatroom",
    });
    const createRes = await createStream(createReq);

    // Attach bob
    const attachReq = create(grackle.AttachStreamRequestSchema, {
      sessionId: "alice",
      fd: createRes.fd,
      targetSessionId: "bob",
      permission: "rw",
      deliveryMode: "async",
    });
    const attachRes = await attachStream(attachReq);

    // Register a real async listener on bob to capture messages
    const received: string[] = [];
    streamRegistry.registerAsyncListener("bob", (_sub, msg) => {
      received.push(msg.content);
    });

    // Alice publishes
    const stream = streamRegistry.getStream(createRes.streamId)!;
    streamRegistry.publish(stream.id, "alice", "hello bob");

    expect(received).toEqual(["hello bob"]);
  });

  it("attach two targets — message delivered to both", async () => {
    const createRes = await createStream(create(grackle.CreateStreamRequestSchema, {
      sessionId: "alice",
      name: "broadcast",
    }));

    await attachStream(create(grackle.AttachStreamRequestSchema, {
      sessionId: "alice",
      fd: createRes.fd,
      targetSessionId: "bob",
      permission: "r",
      deliveryMode: "async",
    }));

    await attachStream(create(grackle.AttachStreamRequestSchema, {
      sessionId: "alice",
      fd: createRes.fd,
      targetSessionId: "charlie",
      permission: "r",
      deliveryMode: "async",
    }));

    const bobReceived: string[] = [];
    const charlieReceived: string[] = [];
    streamRegistry.registerAsyncListener("bob", (_sub, msg) => { bobReceived.push(msg.content); });
    streamRegistry.registerAsyncListener("charlie", (_sub, msg) => { charlieReceived.push(msg.content); });

    streamRegistry.publish(createRes.streamId, "alice", "hello everyone");

    expect(bobReceived).toEqual(["hello everyone"]);
    expect(charlieReceived).toEqual(["hello everyone"]);
  });

  it("stream auto-deletes when last subscriber leaves", async () => {
    const createRes = await createStream(create(grackle.CreateStreamRequestSchema, {
      sessionId: "alice",
      name: "ephemeral",
    }));

    // Alice is the only subscriber — unsubscribe her
    const sub = streamRegistry.getSubscription("alice", createRes.fd)!;
    streamRegistry.unsubscribe(sub.id);

    expect(streamRegistry.getStream(createRes.streamId)).toBeUndefined();
    expect(streamRegistry.getStreamByName("ephemeral")).toBeUndefined();
  });
});
