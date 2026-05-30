/**
 * Unit tests for on-demand credential supply (AHP HR6): authenticateForRuntime
 * combines stored + provider credentials and delivers them via the PowerLine
 * `authenticate` RPC, scoped to the runtime, best-effort.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { CredentialProviderConfig } from "@grackle-ai/database";

/** Default config with all providers off (no needs → pre-flight validation is a no-op). */
function allOff(): CredentialProviderConfig {
  return { claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" };
}

const mockGetCredentialProviders = vi.fn(() => allOff());

vi.mock("./adapter-manager.js", () => ({ getConnection: vi.fn() }));
vi.mock("@grackle-ai/database", () => ({
  envRegistry: { getEnvironment: vi.fn(() => ({})) },
  tokenStore: { getBundle: vi.fn(() => ({ tokens: [] })) },
  githubAccountStore: {
    getDefaultGitHubAccount: vi.fn(() => undefined),
    resolveStoredGitHubToken: vi.fn(() => undefined),
  },
  credentialProviders: {
    getCredentialProviders: (...args: unknown[]) => mockGetCredentialProviders(...args),
  },
}));
// Keep the real pre-flight helpers (deriveCredentialNeeds / findUnsatisfiedNeeds /
// formatPreflightCredentialError); only stub the secret-materializing builder so
// tests drive the bundle contents directly.
vi.mock("./credential-bundle.js", async (importActual) => {
  const actual = await importActual<typeof import("./credential-bundle.js")>();
  return { ...actual, buildProviderTokenBundle: vi.fn(async () => ({ tokens: [] })) };
});
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
  client: object;
  environmentId: string;
  port: number;
  transport: { authenticate: ReturnType<typeof vi.fn> };
} {
  return {
    client: {},
    environmentId: "env-1",
    port: 7433,
    transport: { authenticate: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("authenticateForRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenStore.getBundle).mockReturnValue({ tokens: [] } as never);
    vi.mocked(buildProviderTokenBundle).mockResolvedValue({ tokens: [] } as never);
    mockGetCredentialProviders.mockReturnValue(allOff());
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

    expect(conn.transport.authenticate).toHaveBeenCalledTimes(1);
    const arg = conn.transport.authenticate.mock.calls[0][0] as {
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

    const arg = conn.transport.authenticate.mock.calls[0][0] as { tokens: TokenItemLike[] };
    expect(arg.tokens.map((t) => t.name)).toEqual(["e"]);
  });

  it("skips authenticate when there are no credentials", async () => {
    const conn = mockConn();
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    await authenticateForRuntime("env-1", "claude-code");
    expect(conn.transport.authenticate).not.toHaveBeenCalled();
  });

  it("swallows delivery errors (best-effort, never throws)", async () => {
    const conn = mockConn();
    conn.transport.authenticate.mockRejectedValue(new Error("boom"));
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
    vi.mocked(tokenStore.getBundle).mockReturnValue({
      tokens: [tok("e", "env_var", "E")],
    } as never);
    await expect(authenticateForRuntime("env-1", "claude-code")).resolves.toBeUndefined();
  });

  // ── Pre-flight credential validation (#1316) ──────────────
  describe("pre-flight validation", () => {
    /** A provider-tagged token (as buildProviderTokenBundle would emit). */
    function provTok(
      name: string,
      envVar: string,
      provider: string,
    ): TokenItemLike & { provider: string } {
      return { ...tok(name, "env_var", envVar), provider };
    }

    it("fails fast when an enabled provider's credential is absent", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "api_key" });
      // buildProviderTokenBundle returns nothing → the claude need is unmet.

      await expect(authenticateForRuntime("env-1", "claude-code")).rejects.toBeInstanceOf(
        ConnectError,
      );
      expect(conn.transport.authenticate).not.toHaveBeenCalled();
    });

    it("throws FailedPrecondition with an actionable message", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "api_key" });

      await expect(authenticateForRuntime("env-1", "claude-code")).rejects.toMatchObject({
        code: Code.FailedPrecondition,
      });
    });

    it("proceeds and delivers when the enabled provider's credential is present", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "api_key" });
      vi.mocked(buildProviderTokenBundle).mockResolvedValue({
        tokens: [provTok("anthropic-api-key", "ANTHROPIC_API_KEY", "claude")],
      } as never);

      await authenticateForRuntime("env-1", "claude-code");

      expect(conn.transport.authenticate).toHaveBeenCalledTimes(1);
    });

    it("proceeds when the provider is off (no needs to validate)", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      // Default all-off; buildProviderTokenBundle empty → nothing to deliver, no throw.
      await expect(authenticateForRuntime("env-1", "claude-code")).resolves.toBeUndefined();
      expect(conn.transport.authenticate).not.toHaveBeenCalled();
    });

    it("fails fast on an expired, non-refreshable OAuth file", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "subscription" });
      vi.mocked(buildProviderTokenBundle).mockResolvedValue({
        tokens: [
          {
            name: "claude-credentials",
            type: "file",
            filePath: "~/.claude/.credentials.json",
            value: JSON.stringify({ claudeAiOauth: { accessToken: "a", expiresAt: 1 } }),
            provider: "claude",
          },
        ],
      } as never);

      await expect(authenticateForRuntime("env-1", "claude-code")).rejects.toBeInstanceOf(
        ConnectError,
      );
      expect(conn.transport.authenticate).not.toHaveBeenCalled();
    });

    it("proceeds when an expired OAuth file still has a refresh token", async () => {
      const conn = mockConn();
      vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);
      mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "subscription" });
      vi.mocked(buildProviderTokenBundle).mockResolvedValue({
        tokens: [
          {
            name: "claude-credentials",
            type: "file",
            filePath: "~/.claude/.credentials.json",
            value: JSON.stringify({
              claudeAiOauth: { accessToken: "a", expiresAt: 1, refreshToken: "r" },
            }),
            provider: "claude",
          },
        ],
      } as never);

      await authenticateForRuntime("env-1", "claude-code");

      expect(conn.transport.authenticate).toHaveBeenCalledTimes(1);
    });
  });
});
