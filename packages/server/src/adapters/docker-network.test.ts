/**
 * Tests for Docker adapter behavior when GRACKLE_DOCKER_NETWORK is set (DooD mode).
 *
 * Uses vi.hoisted() to set the env var before ANY module code runs,
 * ensuring the module-level DOCKER_NETWORK constant reads the test value.
 */
import { describe, it, expect, vi, afterAll } from "vitest";

const ORIGINAL_NETWORK = vi.hoisted(() => {
  const orig = process.env.GRACKLE_DOCKER_NETWORK;
  process.env.GRACKLE_DOCKER_NETWORK = "test-grackle-network";
  return orig;
});

// ── Mock logger ─────────────────────────────────────────────
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock adapter-sdk ────────────────────────────────────────
vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  isDevMode: vi.fn().mockReturnValue(false),
  bootstrapPowerLine: vi.fn().mockReturnValue((async function* () { /* no-op */ })()),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: false }),
  buildRemoteKillCommand: vi.fn().mockReturnValue("true"),
  createPowerLineClient: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue({}),
  }),
}));

import { DockerAdapter, type DockerEnvironmentConfig } from "./docker.js";

afterAll(() => {
  if (ORIGINAL_NETWORK === undefined) {
    delete process.env.GRACKLE_DOCKER_NETWORK;
  } else {
    process.env.GRACKLE_DOCKER_NETWORK = ORIGINAL_NETWORK;
  }
});

describe("DockerAdapter with GRACKLE_DOCKER_NETWORK set (DooD mode)", () => {
  const adapter = new DockerAdapter();
  const containerName = "grackle-dood-test";
  const localPort = 9999;
  const image = "test-image:latest";
  const token = "test-token";

  function baseCfg(overrides?: Partial<DockerEnvironmentConfig>): DockerEnvironmentConfig {
    return { image, ...overrides } as DockerEnvironmentConfig;
  }

  it("uses --network instead of -p port mapping in buildRunArgs", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);

    const networkIdx = args.indexOf("--network");
    expect(networkIdx).toBeGreaterThan(-1);
    expect(args[networkIdx + 1]).toBe("test-grackle-network");

    expect(args).not.toContain("-p");
  });

  it("still includes container name, env vars, and image", () => {
    const args = adapter.buildRunArgs(containerName, localPort, image, baseCfg(), token);

    const nameIdx = args.indexOf("--name");
    expect(nameIdx).toBeGreaterThan(-1);
    expect(args[nameIdx + 1]).toBe(containerName);

    expect(args[args.length - 1]).toBe(image);

    const envVars: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-e" && i + 1 < args.length) {
        const [key, ...rest] = args[i + 1]!.split("=");
        envVars[key!] = rest.join("=");
      }
    }
    expect(envVars.GRACKLE_POWERLINE_TOKEN).toBe(token);
  });
});
