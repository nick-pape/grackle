import { describe, it, expect, vi, afterEach } from "vitest";

// ── Mock adapter-sdk ────────────────────────────────────────
vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  isDevMode: vi.fn().mockReturnValue(false),
  bootstrapPowerLine: vi.fn().mockReturnValue((async function* () { /* no-op */ })()),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: false }),
  buildRemoteKillCommand: vi.fn().mockReturnValue("true"),
}));

import { DockerAdapter, type DockerEnvironmentConfig } from "./docker.js";

// ── Helpers ──────────────────────────────────────────────────

function baseCfg(overrides?: Partial<DockerEnvironmentConfig>): DockerEnvironmentConfig {
  return { image: "test-image:latest", ...overrides } as DockerEnvironmentConfig;
}

/** Extract env var values passed via `-e KEY=VAL` flags. */
function getEnvVars(args: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-e" && i + 1 < args.length) {
      const [key, ...rest] = args[i + 1]!.split("=");
      env[key!] = rest.join("=");
    }
  }
  return env;
}

/** Extract volume mounts passed via `-v` flags. */
function getVolumes(args: string[]): string[] {
  const vols: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-v" && i + 1 < args.length) {
      vols.push(args[i + 1]!);
    }
  }
  return vols;
}

const mockExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
const mockSleep = vi.fn().mockResolvedValue(undefined);
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createAdapter(): DockerAdapter {
  return new DockerAdapter({
    exec: mockExec,
    sleep: mockSleep,
    logger: mockLogger,
  });
}

// ── Tests ───────────────────────────────────────────────────

describe("DockerAdapter.buildRunArgs() — credential handling", () => {
  const adapter = createAdapter();
  const containerName = "grackle-test";
  const localPort = 9999;
  const image = "test-image:latest";
  const token = "test-token";

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.COPILOT_CLI_URL;
    delete process.env.COPILOT_CLI_PATH;
    delete process.env.COPILOT_PROVIDER_CONFIG;
    delete process.env.OPENAI_API_KEY;
  });

  it("does not forward any credential env vars even when set on host", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GH_TOKEN = "gho_test";
    process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
    process.env.COPILOT_CLI_URL = "https://copilot.example.com";
    process.env.COPILOT_CLI_PATH = "/usr/bin/copilot";
    process.env.COPILOT_PROVIDER_CONFIG = "{}";
    process.env.OPENAI_API_KEY = "sk-openai";

    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);
    const env = getEnvVars(args);

    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("COPILOT_GITHUB_TOKEN");
    expect(env).not.toHaveProperty("COPILOT_CLI_URL");
    expect(env).not.toHaveProperty("COPILOT_CLI_PATH");
    expect(env).not.toHaveProperty("COPILOT_PROVIDER_CONFIG");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("does not mount .credentials.json volume", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);
    const vols = getVolumes(args);
    const credMounts = vols.filter((v) => v.includes(".credentials.json"));
    expect(credMounts).toHaveLength(0);
  });

  it("always includes GRACKLE_POWERLINE_TOKEN", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);
    const env = getEnvVars(args);
    expect(env.GRACKLE_POWERLINE_TOKEN).toBe("test-token");
  });

  it("includes GPU passthrough when configured", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg({ gpus: "all" }), token);
    const gpusIdx = args.indexOf("--gpus");
    expect(gpusIdx).toBeGreaterThan(-1);
    expect(args[gpusIdx + 1]).toBe("all");
  });

  it("passes user-specified env vars from config", () => {
    const cfg = baseCfg({ env: { MY_CUSTOM_VAR: "hello" } });
    const args = adapter.buildRunArgs(containerName, localPort, image, cfg, token);
    const env = getEnvVars(args);
    expect(env.MY_CUSTOM_VAR).toBe("hello");
  });

  it("maps port to 127.0.0.1 when GRACKLE_DOCKER_NETWORK is not set", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);
    const portIdx = args.indexOf("-p");
    expect(portIdx).toBeGreaterThan(-1);
    expect(args[portIdx + 1]).toBe(`127.0.0.1:${localPort}:7433`);
    expect(args).not.toContain("--network");
  });
});

describe("DockerAdapter — DI exec for stop/destroy", () => {
  it("calls injected exec for stop()", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await adapter.stop("env-1", { containerName: "test-container" });

    expect(execFn).toHaveBeenCalledWith(
      "docker",
      ["stop", "test-container"],
    );
  });

  it("calls injected exec for destroy()", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await adapter.destroy("env-1", { containerName: "test-container" });

    expect(execFn).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "test-container"],
    );
  });

  it("uses default container name derived from environmentId", async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await adapter.stop("env-42", {});

    expect(execFn).toHaveBeenCalledWith(
      "docker",
      ["stop", "grackle-env-42"],
    );
  });

  it("does not throw when stop fails (container already stopped)", async () => {
    const execFn = vi.fn().mockRejectedValueOnce(new Error("container not running"));
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await expect(adapter.stop("env-1", { containerName: "test" })).resolves.toBeUndefined();
  });

  it("does not throw when destroy fails (container not found)", async () => {
    const execFn = vi.fn().mockRejectedValueOnce(new Error("no such container"));
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await expect(adapter.destroy("env-1", { containerName: "test" })).resolves.toBeUndefined();
  });
});
