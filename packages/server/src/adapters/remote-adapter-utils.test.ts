import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RemoteExecutor } from "./remote-adapter-utils.js";

// ── Mock logger to avoid pino output in tests ──────────────
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock ports utility ──────────────────────────────────────
vi.mock("../utils/ports.js", () => ({
  findFreePort: vi.fn().mockResolvedValue(9999),
}));

// ── Mock sleep to speed up tests ────────────────────────────
vi.mock("../utils/sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { probeRemotePowerLine, writeRemoteEnvFile, startRemotePowerLine } from "./remote-adapter-utils.js";

// ── Helper ──────────────────────────────────────────────────

function createMockExecutor(overrides?: Partial<RemoteExecutor>): RemoteExecutor {
  return {
    exec: vi.fn().mockResolvedValue(""),
    copyTo: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("probeRemotePowerLine", () => {
  it("resolves when the remote port check succeeds", async () => {
    const executor = createMockExecutor();
    await expect(probeRemotePowerLine(executor)).resolves.toBeUndefined();
    expect(executor.exec).toHaveBeenCalledOnce();
    expect((executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("createConnection");
  });

  it("throws when the remote port check fails", async () => {
    const executor = createMockExecutor({
      exec: vi.fn().mockRejectedValue(new Error("port not listening")),
    });
    await expect(probeRemotePowerLine(executor)).rejects.toThrow("port not listening");
  });
});

describe("writeRemoteEnvFile", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear forwarded env vars to isolate tests
    for (const key of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("writes env file with powerline token", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "test-token-abc");

    // Should have called exec twice: once for writing, once for chmod
    expect(executor.exec).toHaveBeenCalledTimes(2);

    const writeCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writeCall).toContain("writeFileSync");
    expect(writeCall).toContain(".env.sh");

    const chmodCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(chmodCall).toContain("chmod 600");
  });

  it("includes extra env vars in the file", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "tok", { MY_CUSTOM_VAR: "hello" });

    // The base64 content is the last single-quoted arg in the first exec call
    const writeCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Extract the last single-quoted string (the base64 payload)
    const allQuoted = [...writeCall.matchAll(/'([^']+)'/g)];
    const base64Str = allQuoted[allQuoted.length - 1]?.[1];
    expect(base64Str).toBeTruthy();
    const decoded = Buffer.from(base64Str!, "base64").toString("utf8");
    expect(decoded).toContain("GRACKLE_POWERLINE_TOKEN");
    expect(decoded).toContain("MY_CUSTOM_VAR");
    expect(decoded).toContain("hello");
  });

  it("does nothing when token is empty and no env vars are set", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "");
    expect(executor.exec).not.toHaveBeenCalled();
  });

  it("skips env var names that fail validation", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "tok", { "invalid-name!": "bad", VALID_NAME: "good" });

    const writeCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const allQuoted = [...writeCall.matchAll(/'([^']+)'/g)];
    const base64Str = allQuoted[allQuoted.length - 1]?.[1];
    const decoded = Buffer.from(base64Str!, "base64").toString("utf8");
    expect(decoded).toContain("VALID_NAME");
    expect(decoded).not.toContain("invalid-name!");
  });
});

describe("startRemotePowerLine", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("batches env file, start, and probe into a single compound command", async () => {
    const executor = createMockExecutor();
    const result = await startRemotePowerLine(executor, "test-token");

    expect(result.alreadyRunning).toBe(false);

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;

    // Everything is batched into a single bash -c call
    expect(calls).toHaveLength(1);

    const command = calls[0][0] as string;
    expect(command).toContain("bash -c");
    // Env file write (base64 decode via Node)
    expect(command).toContain("writeFileSync");
    expect(command).toContain(".env.sh");
    expect(command).toContain("chmod 600");
    // PowerLine start
    expect(command).toContain("nohup node");
    expect(command).toContain("--port=");
    // Probe (TCP connect check)
    expect(command).toContain("createConnection");
  });

  it("throws when compound command and fallback probe both fail", async () => {
    const executor = createMockExecutor({
      exec: vi.fn().mockRejectedValue(new Error("port not listening")),
    });

    await expect(startRemotePowerLine(executor, "test-token"))
      .rejects.toThrow("PowerLine process died immediately after starting");

    // Should have tried compound command, then fallback probe
    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain("bash -c");
    expect(calls[1][0]).toContain("createConnection");
  });

  it("uses workingDirectory when provided", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "tok", { workingDirectory: "/workspaces/myrepo" });

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("cd /workspaces/myrepo");
  });

  it("auto-detects workspace directory when autoDetectWorkspace is true", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "tok", { autoDetectWorkspace: true });

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const command = calls[0][0] as string;
    // Should detect /workspaces/*/ inline
    expect(command).toContain("ls -d /workspaces/*/");
    expect(command).toContain("$WD");
  });

  it("returns alreadyRunning=true when probeFirst finds PowerLine alive", async () => {
    const executor = createMockExecutor({
      exec: vi.fn().mockResolvedValue("__PL_ALIVE__"),
    });

    const result = await startRemotePowerLine(executor, "tok", { probeFirst: true });
    expect(result.alreadyRunning).toBe(true);

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    // Should contain the probe-first prefix
    const command = calls[0][0] as string;
    expect(command).toContain("__PL_ALIVE__");
    expect(command).toContain("exit 0");
  });

  it("falls back to separate probe when compound command fails but PowerLine starts", async () => {
    let callCount = 0;
    const executor = createMockExecutor({
      exec: vi.fn().mockImplementation(() => {
        callCount++;
        // First call (compound) fails — simulates SSH exit 255 on backgrounding
        if (callCount === 1) {
          return Promise.reject(new Error("exit code 255"));
        }
        // Second call (fallback probe) succeeds
        return Promise.resolve("");
      }),
    });

    const result = await startRemotePowerLine(executor, "tok");
    expect(result.alreadyRunning).toBe(false);
    expect(callCount).toBe(2);
  });
});
