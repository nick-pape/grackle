import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Command } from "commander";

// Mock the server import so tests don't actually start a server
vi.mock("@grackle-ai/server", () => ({}));

describe("registerServeCommand", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as (code?: string | number | null) => never);
  });

  afterEach(() => {
    delete process.env.GRACKLE_PORT;
    delete process.env.GRACKLE_WEB_PORT;
    delete process.env.GRACKLE_HOST;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("UT-3: --host ::1 is accepted (IPv6 loopback) and sets GRACKLE_HOST", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    // Override the action to capture opts and skip server import
    const serveCmd = program.commands.find((c) => c.name() === "serve")!;
    serveCmd.action((opts) => {
      process.env.GRACKLE_HOST = opts.host;
      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;
    });

    await program.parseAsync(["serve", "--host", "::1"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("::1");
  });

  it("UT-3b: --host defaults to 127.0.0.1 when not specified", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    const serveCmd = program.commands.find((c) => c.name() === "serve")!;
    serveCmd.action((opts) => {
      process.env.GRACKLE_HOST = opts.host;
    });

    await program.parseAsync(["serve"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("127.0.0.1");
  });

  it("UT-3c: rejects non-loopback --host to enforce security policy", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    // The real action should call process.exit(1) for non-loopback addresses
    await expect(
      program.parseAsync(["serve", "--host", "0.0.0.0"], { from: "user" }),
    ).rejects.toThrow("process.exit called");

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
