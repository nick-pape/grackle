import { describe, it, expect, vi } from "vitest";
import type { RemoteExecutor } from "./remote-executor.js";
import { probeRemotePowerLine, writeRemoteEnvFile, startRemotePowerLine } from "./bootstrap.js";

// ── Helper ──────────────────────────────────────────────────

function createMockExecutor(overrides?: Partial<RemoteExecutor>): RemoteExecutor {
  return {
    exec: vi.fn().mockResolvedValue(""),
    copyTo: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Silent logger to suppress console output in tests. */
const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

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
  it("writes env file with powerline token", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "test-token-abc", undefined, silentLogger);

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
    await writeRemoteEnvFile(executor, "tok", { MY_CUSTOM_VAR: "hello" }, silentLogger);

    const writeCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
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
    await writeRemoteEnvFile(executor, "", undefined, silentLogger);
    expect(executor.exec).not.toHaveBeenCalled();
  });

  it("skips env var names that fail validation", async () => {
    const executor = createMockExecutor();
    await writeRemoteEnvFile(executor, "tok", { "invalid-name!": "bad", VALID_NAME: "good" }, silentLogger);

    const writeCall = (executor.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const allQuoted = [...writeCall.matchAll(/'([^']+)'/g)];
    const base64Str = allQuoted[allQuoted.length - 1]?.[1];
    const decoded = Buffer.from(base64Str!, "base64").toString("utf8");
    expect(decoded).toContain("VALID_NAME");
    expect(decoded).not.toContain("invalid-name!");
  });
});

describe("startRemotePowerLine", () => {
  it("batches env file, spawn, and probe into a single compound command", async () => {
    const executor = createMockExecutor();
    const result = await startRemotePowerLine(executor, "test-token", { logger: silentLogger });

    expect(result.alreadyRunning).toBe(false);

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;

    // Everything is batched into a single bash -c call
    expect(calls).toHaveLength(1);

    const command = calls[0][0] as string;
    expect(command).toContain("bash -c");
    expect(command).toContain("writeFileSync");
    expect(command).toContain(".env.sh");
    expect(command).toContain("chmod 600");
    expect(command).toContain("spawn");
    expect(command).toContain("detached:true");
    expect(command).toContain("unref");
    expect(command).toContain("createConnection");
  });

  it("throws when compound command fails", async () => {
    const executor = createMockExecutor({
      exec: vi.fn().mockRejectedValue(new Error("port not listening")),
    });

    await expect(startRemotePowerLine(executor, "test-token", { logger: silentLogger }))
      .rejects.toThrow("PowerLine process died immediately after starting");

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("bash -c");
  });

  it("uses workingDirectory when provided", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "tok", { workingDirectory: "/workspaces/myrepo", logger: silentLogger });

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('cd "/workspaces/myrepo"');
  });

  it("auto-detects workspace directory when autoDetectWorkspace is true", async () => {
    const executor = createMockExecutor();
    await startRemotePowerLine(executor, "tok", { autoDetectWorkspace: true, logger: silentLogger });

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const command = calls[0][0] as string;
    expect(command).toContain("ls -d /workspaces/*/");
    expect(command).toContain("$WD");
  });

  it("returns alreadyRunning=true when probeFirst finds PowerLine alive", async () => {
    const executor = createMockExecutor({
      exec: vi.fn().mockResolvedValue("__PL_ALIVE__"),
    });

    const result = await startRemotePowerLine(executor, "tok", { probeFirst: true, logger: silentLogger });
    expect(result.alreadyRunning).toBe(true);

    const calls = (executor.exec as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const command = calls[0][0] as string;
    expect(command).toContain("__PL_ALIVE__");
    expect(command).toContain("exit 0");
  });
});
