import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Command } from "commander";

// Mock the server import so the real action can run without starting an actual server
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
    delete process.env.GRACKLE_NO_OPEN;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("defaults to 127.0.0.1 bind host", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("127.0.0.1");
    expect(process.env.GRACKLE_PORT).toBe("7434");
    expect(process.env.GRACKLE_WEB_PORT).toBe("3000");
  });

  it("--allow-network sets GRACKLE_HOST to 0.0.0.0", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--allow-network"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("0.0.0.0");
  });

  it("--no-open sets GRACKLE_NO_OPEN=1", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--no-open"], { from: "user" });

    expect(process.env.GRACKLE_NO_OPEN).toBe("1");
  });

  it("accepts custom port options", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--port", "8000", "--web-port", "8001", "--mcp-port", "8002"], { from: "user" });

    expect(process.env.GRACKLE_PORT).toBe("8000");
    expect(process.env.GRACKLE_WEB_PORT).toBe("8001");
    expect(process.env.GRACKLE_MCP_PORT).toBe("8002");
  });
});
