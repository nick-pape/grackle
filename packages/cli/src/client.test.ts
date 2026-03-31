import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@connectrpc/connect", () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: vi.fn((opts: { baseUrl: string }) => ({ baseUrl: opts.baseUrl })),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: {
    GrackleCore: {},
    GrackleOrchestration: {},
    GrackleScheduling: {},
    GrackleKnowledge: {},
  },
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

describe("createGrackleClients", () => {
  afterEach(() => {
    // Clean up env overrides between tests
    delete process.env.GRACKLE_URL;
    delete process.env.GRACKLE_API_KEY;
    delete process.env.GRACKLE_HOME;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("UT-1: defaults to http://127.0.0.1:7434 (not localhost)", async () => {
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClients } = await import("./client.js");

    createGrackleClients();

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://127.0.0.1:7434" }),
    );
  });

  it("UT-2: uses GRACKLE_URL env var when set", async () => {
    process.env.GRACKLE_URL = "http://192.168.1.10:7434";
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClients } = await import("./client.js");

    createGrackleClients();

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://192.168.1.10:7434" }),
    );
  });

  it("UT-1b: explicit serverUrl argument overrides default", async () => {
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createGrackleClients } = await import("./client.js");

    createGrackleClients("http://[::1]:9000");

    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "http://[::1]:9000" }),
    );
  });

  it("UT-3: throws when API key file is missing", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    const { createGrackleClients } = await import("./client.js");

    expect(() => createGrackleClients()).toThrow(
      "Could not read API key from",
    );
  });

  it("UT-4: throws when API key file is empty", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.readFileSync).mockReturnValue("");
    const { createGrackleClients } = await import("./client.js");

    expect(() => createGrackleClients()).toThrow(
      "API key file is empty",
    );
  });

  it("UT-5: uses explicit apiKey argument when provided", async () => {
    const fs = await import("node:fs");
    const { createGrackleClients } = await import("./client.js");

    createGrackleClients(undefined, "injected-key");

    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("UT-6: GRACKLE_API_KEY env var takes precedence over file", async () => {
    process.env.GRACKLE_API_KEY = "env-key";
    const fs = await import("node:fs");
    const { createGrackleClients } = await import("./client.js");

    createGrackleClients();

    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
