/**
 * Unit tests for on-demand credential supply (AHP HR6): authenticateForRuntime
 * combines stored + provider credentials and delivers them via the PowerLine
 * `authenticate` RPC, scoped to the runtime, best-effort.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./adapter-manager.js", () => ({ getConnection: vi.fn() }));
vi.mock("@grackle-ai/database", () => ({
  envRegistry: { getEnvironment: vi.fn(() => ({})) },
  tokenStore: { getBundle: vi.fn(() => ({ tokens: [] })) },
}));
vi.mock("./credential-bundle.js", () => ({
  buildProviderTokenBundle: vi.fn(async () => ({ tokens: [] })),
}));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { authenticateForRuntime } from "./token-push.js";
import * as adapterManager from "./adapter-manager.js";
import { tokenStore } from "@grackle-ai/database";
import { buildProviderTokenBundle } from "./credential-bundle.js";

interface TokenItemLike {
  name: string;
  type: string;
  envVar: string;
  filePath: string;
  value: string;
}

function tok(name: string, type: string, envVar: string): TokenItemLike {
  return { name, type, envVar, filePath: type === "file" ? "~/x" : "", value: "v" };
}

function mockConn(): {
  client: { authenticate: ReturnType<typeof vi.fn> };
  environmentId: string;
  port: number;
} {
  return {
    client: { authenticate: vi.fn().mockResolvedValue({}) },
    environmentId: "env-1",
    port: 7433,
  };
}

describe("authenticateForRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenStore.getBundle).mockReturnValue({ tokens: [] } as never);
    vi.mocked(buildProviderTokenBundle).mockResolvedValue({ tokens: [] } as never);
  });

  it("does nothing when the environment is not connected", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    await expect(authenticateForRuntime("env-1", "claude-code")).resolves.toBeUndefined();
  });

  it("delivers the combined stored + provider bundle via authenticate", async () => {
    const conn = mockConn();
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(tokenStore.getBundle).mockReturnValue({
      tokens: [tok("u", "env_var", "U")],
    } as never);
    vi.mocked(buildProviderTokenBundle).mockResolvedValue({
      tokens: [tok("p", "env_var", "P")],
    } as never);

    await authenticateForRuntime("env-1", "claude-code");

    expect(conn.client.authenticate).toHaveBeenCalledTimes(1);
    const arg = conn.client.authenticate.mock.calls[0][0] as {
      provider: string;
      tokens: TokenItemLike[];
    };
    expect(arg.provider).toBe("claude-code");
    expect(arg.tokens.map((t) => t.envVar)).toEqual(["U", "P"]);
  });

  it("excludes file tokens when requested", async () => {
    const conn = mockConn();
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(tokenStore.getBundle).mockReturnValue({ tokens: [tok("f", "file", "")] } as never);
    vi.mocked(buildProviderTokenBundle).mockResolvedValue({
      tokens: [tok("e", "env_var", "E")],
    } as never);

    await authenticateForRuntime("env-1", "claude-code", { excludeFileTokens: true });

    const arg = conn.client.authenticate.mock.calls[0][0] as { tokens: TokenItemLike[] };
    expect(arg.tokens.map((t) => t.name)).toEqual(["e"]);
  });

  it("skips authenticate when there are no credentials", async () => {
    const conn = mockConn();
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    await authenticateForRuntime("env-1", "claude-code");
    expect(conn.client.authenticate).not.toHaveBeenCalled();
  });

  it("swallows delivery errors (best-effort, never throws)", async () => {
    const conn = mockConn();
    conn.client.authenticate.mockRejectedValue(new Error("boom"));
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(tokenStore.getBundle).mockReturnValue({
      tokens: [tok("e", "env_var", "E")],
    } as never);
    await expect(authenticateForRuntime("env-1", "claude-code")).resolves.toBeUndefined();
  });
});
