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

// ── Mock adapter-sdk ────────────────────────────────────────
const createAhpMockNet = vi.hoisted(() =>
  vi.fn().mockImplementation(async () => ({
    transport: { handleNotification: () => {} } as never,
    socket: {
      request: vi.fn().mockResolvedValue(null),
      close: () => Promise.resolve(),
    } as never,
  })),
);
vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  isDevMode: vi.fn().mockReturnValue(false),
  bootstrapPowerLine: vi.fn().mockReturnValue(
    (async function* () {
      /* no-op */
    })(),
  ),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: false }),
  buildRemoteKillCommand: vi.fn().mockReturnValue("true"),
  createAhpHostTransport: createAhpMockNet,
}));

import { DockerAdapter, type DockerEnvironmentConfig } from "./docker.js";

afterAll(() => {
  if (ORIGINAL_NETWORK === undefined) {
    delete process.env.GRACKLE_DOCKER_NETWORK;
  } else {
    process.env.GRACKLE_DOCKER_NETWORK = ORIGINAL_NETWORK;
  }
});

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("DockerAdapter with GRACKLE_DOCKER_NETWORK set (DooD mode)", () => {
  const adapter = new DockerAdapter({ logger: mockLogger });
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

describe("DockerAdapter attach mode with GRACKLE_DOCKER_NETWORK set", () => {
  const adapter = new DockerAdapter({
    exec: vi.fn(async (command: string, args: string[]) => {
      if (
        command === "docker" &&
        args[0] === "inspect" &&
        args.some((a) => a.includes("State.Running"))
      ) {
        return { stdout: "true", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }),
    logger: mockLogger,
  });

  it("connects to the attached container by name on the shared network (no sidecar)", async () => {
    const { createAhpHostTransport } = await import("@grackle-ai/adapter-sdk");
    for await (const _ of adapter.provision(
      "env-dood",
      { attach: "ext-box" } as unknown as Record<string, unknown>,
      "tok",
    )) {
      /* consume */
    }
    await adapter.connect(
      "env-dood",
      { attach: "ext-box" } as unknown as Record<string, unknown>,
      "tok",
    );
    expect(createAhpHostTransport).toHaveBeenCalledWith("http://ext-box:7433", "tok", "env-dood");
  });
});
