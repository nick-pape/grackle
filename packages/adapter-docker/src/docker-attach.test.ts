/**
 * Tests for Docker adapter ATTACH mode (issue #1223): attaching to a
 * pre-existing, externally-managed container instead of `docker run`.
 *
 * GRACKLE_DOCKER_NETWORK is left unset here so the IP-probe and socat-sidecar
 * connectivity paths are exercised. The shared-network (name) path is covered
 * in docker-network.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock adapter-sdk ────────────────────────────────────────
// bootstrapPowerLine / startRemotePowerLine / createPowerLineClient are mocked
// so no real container or network is touched.
const pingMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  isDevMode: vi.fn().mockReturnValue(false),
  bootstrapPowerLine: vi.fn().mockReturnValue((async function* () { /* no-op */ })()),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: false }),
  buildRemoteKillCommand: vi.fn().mockReturnValue("KILL_PL"),
  createPowerLineClient: vi.fn().mockReturnValue({ ping: pingMock }),
}));

import * as sdk from "@grackle-ai/adapter-sdk";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import { DockerAdapter, DockerExecutor, type DockerEnvironmentConfig } from "./docker.js";

// ── Helpers ──────────────────────────────────────────────────

interface ScriptedExecOptions {
  /** Value returned by the `State.Running` inspect (default "true"). */
  running?: string;
  /** Value returned by the IP-address inspect (default "172.18.0.7"). */
  ip?: string;
  /** Value returned by the network-name inspect (default "bridge"). */
  network?: string;
  /** When set, the running inspect rejects (container missing). */
  inspectThrows?: boolean;
}

/**
 * Build an exec mock that routes by docker subcommand so attach-mode
 * provisioning can be driven deterministically.
 */
function scriptedExec(opts: ScriptedExecOptions = {}): ReturnType<typeof vi.fn> {
  const running = opts.running ?? "true";
  const ip = opts.ip ?? "172.18.0.7";
  const network = opts.network ?? "bridge";
  return vi.fn(async (command: string, args: string[]) => {
    if (command === "docker" && args[0] === "inspect") {
      if (opts.inspectThrows) {
        throw new Error("No such object");
      }
      const fmtIdx = args.indexOf("-f");
      const fmt = fmtIdx >= 0 ? args[fmtIdx + 1] ?? "" : "";
      if (fmt.includes("State.Running")) {
        return { stdout: running, stderr: "" };
      }
      if (fmt.includes("IPAddress")) {
        return { stdout: ip, stderr: "" };
      }
      if (fmt.includes("NetworkSettings.Networks")) {
        return { stdout: network, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Find the `docker run` invocation (the socat sidecar), if any. */
function findDockerRun(execFn: ReturnType<typeof vi.fn>): string[] | undefined {
  for (const call of execFn.mock.calls) {
    const [command, args] = call as [string, string[]];
    if (command === "docker" && args[0] === "run") {
      return args;
    }
  }
  return undefined;
}

/** Return true if any exec call matched `docker <args...>`. */
function calledDocker(execFn: ReturnType<typeof vi.fn>, predicate: (args: string[]) => boolean): boolean {
  return execFn.mock.calls.some((call) => {
    const [command, args] = call as [string, string[]];
    return command === "docker" && predicate(args);
  });
}

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) { /* consume */ }
}

const TOKEN = "pl-token";
const ATTACH = "demo-ext";

beforeEach(() => {
  vi.clearAllMocks();
  pingMock.mockResolvedValue({});
});

// ── Tests ───────────────────────────────────────────────────

describe("DockerAdapter attach mode — provisioning", () => {
  it("does NOT create a container (no pull/build/run of an image)", async () => {
    const execFn = scriptedExec();
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-a", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    expect(calledDocker(execFn, (a) => a[0] === "pull")).toBe(false);
    expect(calledDocker(execFn, (a) => a[0] === "build")).toBe(false);
    // The only `docker run` permitted is the socat sidecar (never the target image).
    const run = findDockerRun(execFn);
    if (run) {
      expect(run).not.toContain("test-image:latest");
      expect(run.join(" ")).toContain("socat");
    }
  });

  it("verifies the target container is running via docker inspect", async () => {
    const execFn = scriptedExec({ running: "true" });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-b", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    expect(calledDocker(execFn, (a) => a[0] === "inspect" && a.includes(ATTACH)
      && a.some((x) => x.includes("State.Running")))).toBe(true);
  });

  it("throws a clear error when the target container is not running (never falls back to create)", async () => {
    const execFn = scriptedExec({ running: "false" });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await expect(drain(adapter.provision("env-c", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN)))
      .rejects.toThrow(/not running|running/i);
    expect(findDockerRun(execFn)).toBeUndefined();
  });

  it("throws when the target container does not exist", async () => {
    const execFn = scriptedExec({ inspectThrows: true });
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await expect(drain(adapter.provision("env-d", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN)))
      .rejects.toThrow();
    expect(findDockerRun(execFn)).toBeUndefined();
  });

  it("bootstraps PowerLine inside the target (full bootstrap on provision)", async () => {
    const execFn = scriptedExec();
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-e", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    expect(sdk.bootstrapPowerLine).toHaveBeenCalledTimes(1);
    // Docker containers must bind 0.0.0.0 so the IP/sidecar paths can reach PowerLine.
    const opts = vi.mocked(sdk.bootstrapPowerLine).mock.calls[0]![2];
    expect(opts).toMatchObject({ host: "0.0.0.0" });
  });
});

describe("DockerAdapter attach mode — connectivity", () => {
  it("uses the container bridge IP directly when reachable from the host", async () => {
    const execFn = scriptedExec({ ip: "172.18.0.7" });
    pingMock.mockResolvedValue({}); // IP probe succeeds
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-ip", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    // Reachable IP → no socat sidecar needed
    expect(findDockerRun(execFn)).toBeUndefined();

    await adapter.connect("env-ip", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN);
    expect(sdk.createPowerLineClient).toHaveBeenCalledWith(
      `http://172.18.0.7:${DEFAULT_POWERLINE_PORT}`,
      TOKEN,
    );
  });

  it("starts a socat sidecar joined to the target network when the IP is unreachable", async () => {
    const execFn = scriptedExec({ ip: "172.18.0.7", network: "coder_net" });
    pingMock.mockRejectedValue(new Error("unreachable")); // host cannot reach container IP (Docker Desktop)
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-sc", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    const run = findDockerRun(execFn);
    expect(run).toBeDefined();
    const joined = run!.join(" ");
    // sidecar joins the target's network and forwards to the target IP, publishing to host
    expect(run).toContain("--network");
    expect(run![run!.indexOf("--network") + 1]).toBe("coder_net");
    expect(joined).toContain("grackle-attach-env-sc");
    expect(joined).toContain(`TCP:172.18.0.7:${DEFAULT_POWERLINE_PORT}`);
    // host port publish on loopback
    expect(run!.some((a) => /^127\.0\.0\.1:\d+:7433$/.test(a))).toBe(true);
    // never share the target's net namespace (that conflicts with -p)
    expect(joined).not.toContain(`container:${ATTACH}`);
  });

  it("connect() re-resolves connectivity when there is no cached entry (server-restart recovery)", async () => {
    const execFn = scriptedExec({ ip: "172.18.0.7" });
    pingMock.mockResolvedValue({}); // reachable by IP
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    // No provision() first — simulates a server restart that lost in-memory state.
    const conn = await adapter.connect("env-recover", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN);

    expect(sdk.createPowerLineClient).toHaveBeenCalledWith(
      `http://172.18.0.7:${DEFAULT_POWERLINE_PORT}`,
      TOKEN,
    );
    expect(conn.port).toBe(DEFAULT_POWERLINE_PORT);
  });
});

describe("DockerAdapter attach mode — lifecycle safety (issue #1223)", () => {
  it("stop() never stops or removes the target container; removes the sidecar only", async () => {
    const execFn = scriptedExec({ ip: "172.18.0.7", network: "coder_net" });
    pingMock.mockRejectedValue(new Error("unreachable")); // force sidecar
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-stop", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));
    execFn.mockClear();

    await adapter.stop("env-stop", { attach: ATTACH });

    expect(calledDocker(execFn, (a) => a[0] === "stop" && a.includes(ATTACH))).toBe(false);
    expect(calledDocker(execFn, (a) => a[0] === "rm" && a.includes(ATTACH))).toBe(false);
    // sidecar is Grackle-owned → may be removed
    expect(calledDocker(execFn, (a) => a[0] === "rm" && a.some((x) => x.includes("grackle-attach-env-stop")))).toBe(true);
  });

  it("destroy() never removes the target container; removes the sidecar only", async () => {
    const execFn = scriptedExec({ ip: "172.18.0.7", network: "coder_net" });
    pingMock.mockRejectedValue(new Error("unreachable")); // force sidecar
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.provision("env-destroy", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));
    execFn.mockClear();

    await adapter.destroy("env-destroy", { attach: ATTACH });

    expect(calledDocker(execFn, (a) => a[0] === "rm" && a.includes(ATTACH))).toBe(false);
    expect(calledDocker(execFn, (a) => a[0] === "stop" && a.includes(ATTACH))).toBe(false);
    expect(calledDocker(execFn, (a) => a[0] === "rm" && a.some((x) => x.includes("grackle-attach-env-destroy")))).toBe(true);
  });
});

describe("DockerExecutor.copyTo — ownership for arbitrary containers", () => {
  it("chowns copied files to the container's actual default user, not a hardcoded grackle", async () => {
    // Simulate a non-grackle container whose default user is uid/gid 1000.
    const execFn = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "exec" && args.includes("id -u")) {
        return { stdout: "1000\n", stderr: "" };
      }
      if (args[0] === "exec" && args.includes("id -g")) {
        return { stdout: "1000\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const executor = new DockerExecutor("coder-workspace", execFn);

    await executor.copyTo("/local/dist", "/opt/pl/dist");

    // chown targets the resolved uid:gid, never the hardcoded grackle:grackle
    expect(execFn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-u", "root", "coder-workspace", "chown", "-R", "1000:1000", "/opt/pl/dist"],
      expect.anything(),
    );
    expect(execFn).not.toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["chown", "-R", "grackle:grackle", "/opt/pl/dist"]),
      expect.anything(),
    );
  });
});

describe("DockerAdapter attach mode — reconnect", () => {
  it("uses the fast restart path (startRemotePowerLine) for attach configs", async () => {
    const execFn = scriptedExec();
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await drain(adapter.reconnect!("env-rc", { attach: ATTACH } as unknown as Record<string, unknown>, TOKEN));

    expect(sdk.startRemotePowerLine).toHaveBeenCalled();
    expect(sdk.bootstrapPowerLine).not.toHaveBeenCalled();
  });

  it("throws for non-attach configs so the create flow falls back to full provision", async () => {
    const execFn = scriptedExec();
    const adapter = new DockerAdapter({ exec: execFn, logger: mockLogger });

    await expect(drain(adapter.reconnect!("env-rc2", { image: "x:latest" } as unknown as Record<string, unknown>, TOKEN)))
      .rejects.toThrow();
  });
});
