import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

// ── Mock the leaf dependencies so we can drive every branch ──────────────────
vi.mock("@grackle-ai/auth", () => ({ verifyChannelToken: vi.fn() }));
vi.mock("@grackle-ai/database", () => ({ channelGrantStore: { getGrant: vi.fn() } }));
vi.mock("./channel-config.js", () => ({
  getChannelConfig: vi.fn(() => ({ signingSecret: "secret", ingressBaseUrl: "http://localhost:3000" })),
}));
vi.mock("./session-handlers.js", () => ({ sendInput: vi.fn() }));

import { verifyChannelToken } from "@grackle-ai/auth";
import { channelGrantStore } from "@grackle-ai/database";
import { sendInput } from "./session-handlers.js";
import { ingestChannelMessage } from "./channel-ingest.js";

const verifyMock = vi.mocked(verifyChannelToken);
const getGrantMock = vi.mocked(channelGrantStore.getGrant);
const sendInputMock = vi.mocked(sendInput);

const CLAIMS = { chan: "grackle:/sessions/s1", verbs: ["send_input"], jti: "g1", iat: 1, exp: 9_999_999_999 };
const GRANT = {
  id: "g1",
  channelUri: "grackle:/sessions/s1",
  verbs: "send_input",
  label: "",
  expiresAt: null as string | null,
  revoked: false,
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockReturnValue({ ...CLAIMS });
  getGrantMock.mockReturnValue({ ...GRANT });
  sendInputMock.mockResolvedValue(create(grackle.EmptySchema, {}));
});

describe("ingestChannelMessage", () => {
  it("delivers a valid message and parses the session id from the channel", async () => {
    const res = await ingestChannelMessage("tok", { message: "hello" });
    expect(res.outcome).toBe("delivered");
    expect(res.sessionId).toBe("s1");
    expect(res.channelUri).toBe("grackle:/sessions/s1");
    expect(sendInputMock).toHaveBeenCalledTimes(1);
    const arg = sendInputMock.mock.calls[0]![0] as { sessionId: string; text: string };
    expect(arg.sessionId).toBe("s1");
    expect(arg.text).toBe("hello");
  });

  it("prefixes sender attribution when `from` is set", async () => {
    await ingestChannelMessage("tok", { message: "hi", from: "alice@teams" });
    const arg = sendInputMock.mock.calls[0]![0] as { text: string };
    expect(arg.text).toBe("[alice@teams] hi");
  });

  it("rejects an invalid/expired token", async () => {
    verifyMock.mockReturnValue(undefined);
    expect((await ingestChannelMessage("bad", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("rejects when the grant row is missing", async () => {
    getGrantMock.mockReturnValue(undefined);
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked grant", async () => {
    getGrantMock.mockReturnValue({ ...GRANT, revoked: true });
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("rejects when the persisted grant channel does not match the token claim", async () => {
    getGrantMock.mockReturnValue({ ...GRANT, channelUri: "grackle:/sessions/OTHER" });
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("rejects when the token verbs lack send_input", async () => {
    verifyMock.mockReturnValue({ ...CLAIMS, verbs: ["read_events"] });
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("rejects when the stored grant verbs lack send_input", async () => {
    getGrantMock.mockReturnValue({ ...GRANT, verbs: "read_events" });
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("forbidden");
    expect(sendInputMock).not.toHaveBeenCalled();
  });

  it("maps a not-found session to not_found", async () => {
    sendInputMock.mockRejectedValue(new ConnectError("missing", Code.NotFound));
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("not_found");
  });

  it("maps an ended session (FailedPrecondition) to ended (410)", async () => {
    sendInputMock.mockRejectedValue(new ConnectError("ended", Code.FailedPrecondition));
    expect((await ingestChannelMessage("tok", { message: "x" })).outcome).toBe("ended");
  });

  it("dedupes repeated idempotency keys (delivers once)", async () => {
    const body = { message: "once", idempotencyKey: "unique-dedup-key" };
    const r1 = await ingestChannelMessage("tok", body);
    const r2 = await ingestChannelMessage("tok", body);
    expect(r1.outcome).toBe("delivered");
    expect(r2.outcome).toBe("delivered");
    expect(sendInputMock).toHaveBeenCalledTimes(1);
  });
});
