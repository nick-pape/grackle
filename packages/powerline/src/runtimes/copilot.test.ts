import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

import { resolveGithubToken, resolveProviderConfig, resolveMcpServers, buildFindingTool, CopilotRuntime } from "./copilot.js";
import { existsSync, readFileSync } from "node:fs";
import { AsyncQueue } from "../utils/async-queue.js";
import type { AgentEvent } from "./runtime.js";

describe("resolveGithubToken", () => {
  beforeEach(() => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns COPILOT_GITHUB_TOKEN when set (highest priority)", () => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "copilot-token");
    vi.stubEnv("GH_TOKEN", "gh-token");
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("copilot-token");
  });

  it("falls back to GH_TOKEN when COPILOT_GITHUB_TOKEN is not set", () => {
    vi.stubEnv("GH_TOKEN", "gh-token");
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("gh-token");
  });

  it("falls back to GITHUB_TOKEN as last resort", () => {
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("github-token");
  });

  it("returns undefined when no token env vars are set", () => {
    expect(resolveGithubToken()).toBeUndefined();
  });
});

describe("resolveProviderConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses valid JSON", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", '{"type":"openai","apiKey":"key123"}');
    const config = resolveProviderConfig();
    expect(config).toEqual({ type: "openai", apiKey: "key123" });
  });

  it("returns undefined when not set", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", "");
    expect(resolveProviderConfig()).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", "not-json{");
    expect(resolveProviderConfig()).toBeUndefined();
  });
});

describe("resolveMcpServers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it("loads servers from config file", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          myServer: { command: "node", args: ["server.js"] },
        },
      }),
    );

    const result = resolveMcpServers();
    expect(result).toBeDefined();
    expect(result!.myServer).toEqual({ command: "node", args: ["server.js"] });
  });

  it("merges spawn servers with config file servers", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { fileServer: { command: "a" } },
      }),
    );

    const result = resolveMcpServers({ spawnServer: { command: "b" } });
    expect(result).toBeDefined();
    expect(result!.fileServer).toEqual({ command: "a" });
    expect(result!.spawnServer).toEqual({ command: "b" });
  });

  it("auto-injects grackle server when script exists", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    // existsSync returns true for the GRACKLE_MCP_SCRIPT path
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p) === "/app/mcp-grackle/index.js";
    });

    const result = resolveMcpServers();
    expect(result).toBeDefined();
    expect(result!.grackle).toEqual({
      command: "node",
      args: ["/app/mcp-grackle/index.js"],
      tools: ["post_finding", "get_task_context", "update_task_status"],
    });
  });

  it("ignores malformed config file", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/bad.json");
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/tmp/bad.json");
    vi.mocked(readFileSync).mockReturnValue("not valid json");

    const result = resolveMcpServers();
    expect(result).toBeUndefined();
  });

  it("returns undefined when no servers configured and script not present", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    vi.mocked(existsSync).mockReturnValue(false);

    expect(resolveMcpServers()).toBeUndefined();
  });
});

describe("buildFindingTool", () => {
  it("returns tool with correct structure", () => {
    const queue = new AsyncQueue<AgentEvent>();
    let capturedName = "";
    let capturedOpts: Record<string, unknown> = {};
    const mockDefineTool = (name: string, opts: Record<string, unknown>): unknown => {
      capturedName = name;
      capturedOpts = opts;
      return { name, ...opts };
    };

    buildFindingTool(mockDefineTool, queue);
    expect(capturedName).toBe("post_finding");
    expect(capturedOpts.description).toBeDefined();
    expect(capturedOpts.parameters).toBeDefined();

    const params = capturedOpts.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    const properties = params.properties as Record<string, unknown>;
    expect(properties.title).toBeDefined();
    expect(properties.content).toBeDefined();
    expect(properties.category).toBeDefined();
    expect(properties.tags).toBeDefined();

    queue.close();
  });

  it("handler pushes finding event to queue with defaults for missing fields", async () => {
    const queue = new AsyncQueue<AgentEvent>();
    let handler: (args: Record<string, unknown>) => Promise<unknown> = async () => ({});
    const mockDefineTool = (_name: string, opts: Record<string, unknown>): unknown => {
      handler = opts.handler as typeof handler;
      return {};
    };

    buildFindingTool(mockDefineTool, queue);

    const result = await handler({ title: "My Finding", content: "Details" });
    expect(result).toEqual({ status: "finding_posted", title: "My Finding" });

    const event = await queue.shift();
    expect(event).toBeDefined();
    expect(event!.type).toBe("finding");

    const finding = JSON.parse(event!.content);
    expect(finding.title).toBe("My Finding");
    expect(finding.content).toBe("Details");
    expect(finding.category).toBe("general"); // default
    expect(finding.tags).toEqual([]); // default
    expect(event!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    queue.close();
  });
});

describe("CopilotRuntime structural", () => {
  it("has name 'copilot'", () => {
    const runtime = new CopilotRuntime();
    expect(runtime.name).toBe("copilot");
  });

  it("spawn returns a session with correct properties", () => {
    const runtime = new CopilotRuntime();
    const session = runtime.spawn({
      sessionId: "cop-1",
      prompt: "test",
      model: "gpt-4",
      maxTurns: 5,
    });
    expect(session.id).toBe("cop-1");
    expect(session.runtimeName).toBe("copilot");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", () => {
    const runtime = new CopilotRuntime();
    const session = runtime.resume({
      sessionId: "cop-resume",
      runtimeSessionId: "prev-123",
    });
    expect(session.id).toBe("cop-resume");
    expect(session.runtimeSessionId).toBe("prev-123");
  });
});
