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

  it("writes env file, starts process, and probes successfully", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "test-token");

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;

    // Should have: writeFileSync, chmod, start script (bash -c), probe (createConnection)
    expect(calls.length).toBeGreaterThanOrEqual(4);

    // Verify the start script was invoked via bash -c
    const startCall = calls.find((c: string[]) => (c[0] as string).includes("bash -c"));
    expect(startCall).toBeTruthy();
    expect(startCall![0]).toContain("nohup node");
    expect(startCall![0]).toContain("--port=");

    // Verify probe was called
    const probeCall = calls.find((c: string[]) => (c[0] as string).includes("createConnection"));
    expect(probeCall).toBeTruthy();
  });

  it("throws when probe fails after starting", async () => {
    let callCount = 0;
    const executor = createMockExecutor({
      exec: vi.fn().mockImplementation((command: string) => {
        callCount++;
        // Let everything succeed except the probe (createConnection)
        if (command.includes("createConnection")) {
          return Promise.reject(new Error("port not listening"));
        }
        return Promise.resolve("");
      }),
    });

    await expect(startRemotePowerLine(executor, "test-token"))
      .rejects.toThrow("PowerLine process died immediately after starting");
  });

  it("uses workingDirectory when provided", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "tok", undefined, "/workspaces/myrepo");

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    const startCall = calls.find((c: string[]) => (c[0] as string).includes("bash -c"));
    expect(startCall![0]).toContain("cd /workspaces/myrepo");
  });
});
