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
    delete process.env.GRACKLE_PUBLIC_URL;
    delete process.env.GRACKLE_ALLOW_INSECURE;
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

  it("accepts custom port options", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(
      ["serve", "--port", "8000", "--web-port", "8001", "--mcp-port", "8002"],
      { from: "user" },
    );

    expect(process.env.GRACKLE_PORT).toBe("8000");
    expect(process.env.GRACKLE_WEB_PORT).toBe("8001");
    expect(process.env.GRACKLE_MCP_PORT).toBe("8002");
  });

  it("--public-url sets GRACKLE_PUBLIC_URL", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--public-url", "https://grackle.home"], { from: "user" });

    expect(process.env.GRACKLE_PUBLIC_URL).toBe("https://grackle.home");
  });

  it("leaves GRACKLE_PUBLIC_URL unset when --public-url is omitted", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve"], { from: "user" });

    expect(process.env.GRACKLE_PUBLIC_URL).toBeUndefined();
  });

  it("--insecure sets GRACKLE_ALLOW_INSECURE=1 (#1374)", async () => {
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--allow-network", "--insecure"], { from: "user" });

    expect(process.env.GRACKLE_ALLOW_INSECURE).toBe("1");
  });

  it("--insecure is independent of --allow-network (loopback bind + opt-in still sets the env var)", async () => {
    // The CLI flag is a pure env-var setter; the gate logic lives in the
    // server. The loopback bind makes the gate a no-op, but the env var is
    // still set so this scenario is predictable in tests + scripts.
    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--insecure"], { from: "user" });

    expect(process.env.GRACKLE_HOST).toBe("127.0.0.1");
    expect(process.env.GRACKLE_ALLOW_INSECURE).toBe("1");
  });

  it("preserves an env-supplied GRACKLE_ALLOW_INSECURE=1 when --insecure is NOT passed (Docker image case)", async () => {
    // The Docker image bakes in ENV GRACKLE_ALLOW_INSECURE=1; --insecure
    // would be redundant but should be permitted. When NOT passed, the CLI
    // must not clobber the env value to empty.
    process.env.GRACKLE_ALLOW_INSECURE = "1";

    const { registerServeCommand } = await import("./serve.js");
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program);

    await program.parseAsync(["serve", "--allow-network"], { from: "user" });

    expect(process.env.GRACKLE_ALLOW_INSECURE).toBe("1");
  });
});
