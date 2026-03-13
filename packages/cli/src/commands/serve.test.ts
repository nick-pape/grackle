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
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("UT-3: --host ::1 (IPv6 loopback) is accepted and sets GRACKLE_HOST", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--host", "::1", "--port", "7434", "--web-port", "3000"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("::1");
    expect(process.env.GRACKLE_PORT).toBe("7434");
    expect(process.env.GRACKLE_WEB_PORT).toBe("3000");
  });

  it("UT-3b: --host defaults to 127.0.0.1 when not specified", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("127.0.0.1");
  });

  it("UT-3c: rejects non-loopback --host to enforce security policy", async () => {
    // Suppress console.error so the expected rejection message does not pollute test output
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    // The real action should call process.exit(1) for non-loopback addresses
    await expect(
      program.parseAsync(["serve", "--host", "0.0.0.0"], { from: "user" }),
    ).rejects.toThrow("process.exit called");

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("loopback address"));
  });
});
