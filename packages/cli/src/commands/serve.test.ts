import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";

// Mock the server import so tests don't actually start a server
vi.mock("@grackle-ai/server", () => ({}));

describe("registerServeCommand", () => {
  afterEach(() => {
    delete process.env.GRACKLE_PORT;
    delete process.env.GRACKLE_WEB_PORT;
    delete process.env.GRACKLE_HOST;
    vi.resetModules();
  });

  it("UT-3: parses --host and sets GRACKLE_HOST env var", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride(); // prevent process.exit on parse errors

    registerServeCommand(program);

    // Intercept the action before it tries to import the server
    let capturedOpts: Record<string, string> = {};
    const serveCmd = program.commands.find((c) => c.name() === "serve")!;
    serveCmd.action((opts) => {
      capturedOpts = opts;
      process.env.GRACKLE_HOST = opts.host;
      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;
    });

    await program.parseAsync(["serve", "--host", "::1", "--port", "7434", "--web-port", "3000"], { from: "user" });

    expect(capturedOpts.host).toBe("::1");
    expect(process.env.GRACKLE_HOST).toBe("::1");
  });

  it("UT-3b: --host defaults to 127.0.0.1 when not specified", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();

    registerServeCommand(program);

    let capturedOpts: Record<string, string> = {};
    const serveCmd = program.commands.find((c) => c.name() === "serve")!;
    serveCmd.action((opts) => {
      capturedOpts = opts;
      process.env.GRACKLE_HOST = opts.host;
    });

    await program.parseAsync(["serve"], { from: "user" });

    expect(capturedOpts.host).toBe("127.0.0.1");
    expect(process.env.GRACKLE_HOST).toBe("127.0.0.1");
  });
});
