import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@connectrpc/connect", () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: vi.fn((opts: { baseUrl: string }) => ({ baseUrl: opts.baseUrl })),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: {} },
  DEFAULT_SERVER_PORT: 7434,
  GRACKLE_DIR: ".grackle",
  API_KEY_FILENAME: "api_key",
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "test-api-key"),
}));

vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/user",
}));

describe("createGrackleClient", () => {
  afterEach(() => {
    // Clean up env overrides between tests
    delete process.env.GRACKLE_URL;
    delete process.env.GRACKLE_API_KEY;
    vi.resetModules();
  });

  it("UT-1: defaults to http://127.0.0.1:7434 (not localhost)", async () => {
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClient } = await import("./client.js");

    createGrackleClient();

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:7434" }),
    );
  });

  it("UT-2: uses GRACKLE_URL env var when set", async () => {
    process.env.GRACKLE_URL = "http://192.168.1.10:7434";
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClient } = await import("./client.js");

    createGrackleClient();

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://192.168.1.10:7434" }),
    );
  });

  it("UT-1b: explicit serverUrl argument overrides default", async () => {
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClient } = await import("./client.js");

    createGrackleClient("http://::1:9000");

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://::1:9000" }),
    );
  });
});
