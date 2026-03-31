import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_MCP_PORT, DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";

import { resolveServerConfig } from "./config.js";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveServerConfig", () => {
  it("returns defaults when no env vars are set", () => {
    // Explicitly clear all config env vars in case the test runner has them set
    vi.stubEnv("GRACKLE_PORT", "");
    vi.stubEnv("GRACKLE_WEB_PORT", "");
    vi.stubEnv("GRACKLE_MCP_PORT", "");
    vi.stubEnv("GRACKLE_POWERLINE_PORT", "");
    vi.stubEnv("GRACKLE_HOST", "");
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "");
    vi.stubEnv("GRACKLE_SKIP_ORCHESTRATION", "");
    vi.stubEnv("GRACKLE_SKIP_SCHEDULING", "");
    vi.stubEnv("GRACKLE_KNOWLEDGE_ENABLED", "");

    const config = resolveServerConfig();
    expect(config.grpcPort).toBe(DEFAULT_SERVER_PORT);
    expect(config.webPort).toBe(DEFAULT_WEB_PORT);
    expect(config.mcpPort).toBe(DEFAULT_MCP_PORT);
    expect(config.powerlinePort).toBe(DEFAULT_POWERLINE_PORT);
    expect(config.host).toBe("127.0.0.1");
    expect(config.skipLocalPowerline).toBe(false);
    expect(config.skipRootAutostart).toBe(false);
    expect(config.skipScheduling).toBe(false);
    expect(config.skipOrchestration).toBe(false);
    expect(config.knowledgeEnabled).toBe(false);
  });

  it("parses valid port numbers from env vars", () => {
    vi.stubEnv("GRACKLE_PORT", "9000");
    vi.stubEnv("GRACKLE_WEB_PORT", "9001");
    vi.stubEnv("GRACKLE_MCP_PORT", "9002");
    vi.stubEnv("GRACKLE_POWERLINE_PORT", "9003");

    const config = resolveServerConfig();
    expect(config.grpcPort).toBe(9000);
    expect(config.webPort).toBe(9001);
    expect(config.mcpPort).toBe(9002);
    expect(config.powerlinePort).toBe(9003);
  });

  it("throws on non-numeric port value", () => {
    vi.stubEnv("GRACKLE_PORT", "banana");
    expect(() => resolveServerConfig()).toThrow('Invalid port for GRACKLE_PORT: "banana"');
  });

  it("throws on port below 1", () => {
    vi.stubEnv("GRACKLE_PORT", "0");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on negative port", () => {
    vi.stubEnv("GRACKLE_PORT", "-1");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on port with trailing garbage", () => {
    vi.stubEnv("GRACKLE_PORT", "9000abc");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on decimal port", () => {
    vi.stubEnv("GRACKLE_PORT", "9000.5");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on port above 65535", () => {
    vi.stubEnv("GRACKLE_PORT", "70000");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("accepts port 1 (min valid)", () => {
    vi.stubEnv("GRACKLE_PORT", "1");
    expect(resolveServerConfig().grpcPort).toBe(1);
  });

  it("accepts port 65535 (max valid)", () => {
    vi.stubEnv("GRACKLE_PORT", "65535");
    expect(resolveServerConfig().grpcPort).toBe(65535);
  });

  it("parses boolean flags — '1' is true", () => {
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "1");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "1");
    vi.stubEnv("GRACKLE_SKIP_SCHEDULING", "1");
    vi.stubEnv("GRACKLE_SKIP_ORCHESTRATION", "1");

    const config = resolveServerConfig();
    expect(config.skipLocalPowerline).toBe(true);
    expect(config.skipRootAutostart).toBe(true);
    expect(config.skipScheduling).toBe(true);
    expect(config.skipOrchestration).toBe(true);
  });

  it("parses boolean flags — anything else is false", () => {
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "true");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "0");
    vi.stubEnv("GRACKLE_SKIP_SCHEDULING", "0");
    vi.stubEnv("GRACKLE_SKIP_ORCHESTRATION", "0");

    const config = resolveServerConfig();
    expect(config.skipLocalPowerline).toBe(false);
    expect(config.skipRootAutostart).toBe(false);
    expect(config.skipScheduling).toBe(false);
    expect(config.skipOrchestration).toBe(false);
  });

  it("knowledgeEnabled is true when GRACKLE_KNOWLEDGE_ENABLED=true", () => {
    vi.stubEnv("GRACKLE_KNOWLEDGE_ENABLED", "true");
    expect(resolveServerConfig().knowledgeEnabled).toBe(true);
  });

  it("knowledgeEnabled is false for other values ('1', 'yes', unset)", () => {
    vi.stubEnv("GRACKLE_KNOWLEDGE_ENABLED", "1");
    expect(resolveServerConfig().knowledgeEnabled).toBe(false);

    vi.stubEnv("GRACKLE_KNOWLEDGE_ENABLED", "");
    expect(resolveServerConfig().knowledgeEnabled).toBe(false);
  });

  it("uses GRACKLE_HOST when set", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    expect(resolveServerConfig().host).toBe("0.0.0.0");
  });

  it("returns a frozen object", () => {
    const config = resolveServerConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });
});
