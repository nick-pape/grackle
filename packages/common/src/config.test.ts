import { describe, expect, it } from "vitest";
import {
  resolveGrackleConfig,
  resolveLogConfig,
  resolveNetworkConfig,
  resolvePathConfig,
  resolveDockerConfig,
  resolveFeatureConfig,
  resolveTuningConfig,
} from "./config.js";

describe("resolveLogConfig", () => {
  it("returns defaults when env is empty", () => {
    const cfg = resolveLogConfig({});
    expect(cfg.level).toBe("info");
    expect(cfg.isProduction).toBe(false);
  });

  it("reads LOG_LEVEL", () => {
    expect(resolveLogConfig({ LOG_LEVEL: "debug" }).level).toBe("debug");
  });

  it("detects production", () => {
    expect(resolveLogConfig({ NODE_ENV: "production" }).isProduction).toBe(true);
  });

  it("result is frozen", () => {
    const cfg = resolveLogConfig({});
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

describe("resolveNetworkConfig", () => {
  it("returns port defaults", () => {
    const cfg = resolveNetworkConfig({});
    expect(cfg.grpcPort).toBe(7434);
    expect(cfg.webPort).toBe(3000);
    expect(cfg.mcpPort).toBe(7435);
    expect(cfg.sandboxPort).toBe(7436);
    expect(cfg.powerlinePort).toBe(7433);
    expect(cfg.host).toBe("127.0.0.1");
  });

  it("reads port overrides", () => {
    const cfg = resolveNetworkConfig({ GRACKLE_PORT: "9000", GRACKLE_HOST: "0.0.0.0" });
    expect(cfg.grpcPort).toBe(9000);
    expect(cfg.host).toBe("0.0.0.0");
  });

  it("reads optional origin fields", () => {
    const cfg = resolveNetworkConfig({
      GRACKLE_PUBLIC_URL: "https://grackle.home",
      GRACKLE_MCP_ORIGIN: "https://mcp.home",
      GRACKLE_SANDBOX_ORIGIN: "https://sandbox.home",
    });
    expect(cfg.publicUrl).toBe("https://grackle.home");
    expect(cfg.mcpOrigin).toBe("https://mcp.home");
    expect(cfg.sandboxOrigin).toBe("https://sandbox.home");
  });

  it("omits optional fields when unset", () => {
    const cfg = resolveNetworkConfig({});
    expect(cfg.publicUrl).toBeUndefined();
    expect(cfg.mcpOrigin).toBeUndefined();
    expect(cfg.sandboxOrigin).toBeUndefined();
  });
});

describe("resolvePathConfig", () => {
  it("returns all undefined when env is empty", () => {
    const cfg = resolvePathConfig({});
    expect(cfg.grackleHome).toBeUndefined();
    expect(cfg.workingDirectory).toBeUndefined();
    expect(cfg.worktreeBase).toBeUndefined();
    expect(cfg.webDir).toBeUndefined();
    expect(cfg.mcpConfig).toBeUndefined();
  });

  it("reads all path overrides", () => {
    const cfg = resolvePathConfig({
      GRACKLE_HOME: "/custom/home",
      GRACKLE_WORKING_DIRECTORY: "/work",
      GRACKLE_WORKTREE_BASE: "/trees",
      GRACKLE_WEB_DIR: "/web",
      GRACKLE_MCP_CONFIG: "/mcp.json",
    });
    expect(cfg.grackleHome).toBe("/custom/home");
    expect(cfg.workingDirectory).toBe("/work");
    expect(cfg.worktreeBase).toBe("/trees");
    expect(cfg.webDir).toBe("/web");
    expect(cfg.mcpConfig).toBe("/mcp.json");
  });
});

describe("resolveDockerConfig", () => {
  it("returns defaults", () => {
    const cfg = resolveDockerConfig({});
    expect(cfg.dockerHost).toBeUndefined();
    expect(cfg.dockerSocatImage).toBe("alpine/socat");
    expect(cfg.dockerNetwork).toBeUndefined();
  });

  it("reads overrides", () => {
    const cfg = resolveDockerConfig({
      GRACKLE_DOCKER_HOST: "grackle-server",
      GRACKLE_DOCKER_SOCAT_IMAGE: "custom/socat:v2",
      GRACKLE_DOCKER_NETWORK: "my-net",
    });
    expect(cfg.dockerHost).toBe("grackle-server");
    expect(cfg.dockerSocatImage).toBe("custom/socat:v2");
    expect(cfg.dockerNetwork).toBe("my-net");
  });
});

describe("resolveFeatureConfig", () => {
  it("returns defaults (all skips false, knowledge enabled)", () => {
    const cfg = resolveFeatureConfig({});
    expect(cfg.skipLocalPowerline).toBe(false);
    expect(cfg.skipRootAutostart).toBe(false);
    expect(cfg.skipOrchestration).toBe(false);
    expect(cfg.skipScheduling).toBe(false);
    expect(cfg.knowledgeEnabled).toBe(true);
  });

  it("reads flag overrides", () => {
    const cfg = resolveFeatureConfig({
      GRACKLE_SKIP_LOCAL_POWERLINE: "1",
      GRACKLE_SKIP_ORCHESTRATION: "1",
      GRACKLE_KNOWLEDGE_ENABLED: "false",
    });
    expect(cfg.skipLocalPowerline).toBe(true);
    expect(cfg.skipOrchestration).toBe(true);
    expect(cfg.knowledgeEnabled).toBe(false);
  });
});

describe("resolveTuningConfig", () => {
  it("returns defaults", () => {
    const cfg = resolveTuningConfig({});
    expect(cfg.reconciliationTickMs).toBe(10_000);
    expect(cfg.kgSpawnContextTimeoutMs).toBe(1_500);
  });

  it("reads overrides", () => {
    const cfg = resolveTuningConfig({
      GRACKLE_RECONCILIATION_TICK_MS: "5000",
      GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS: "3000",
    });
    expect(cfg.reconciliationTickMs).toBe(5000);
    expect(cfg.kgSpawnContextTimeoutMs).toBe(3000);
  });

  it("clamps to min 1", () => {
    const cfg = resolveTuningConfig({
      GRACKLE_RECONCILIATION_TICK_MS: "0",
      GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS: "-5",
    });
    expect(cfg.reconciliationTickMs).toBe(1);
    expect(cfg.kgSpawnContextTimeoutMs).toBe(1);
  });
});

describe("resolveGrackleConfig", () => {
  it("composes all sub-configs", () => {
    const cfg = resolveGrackleConfig({ env: {} });
    expect(cfg.network.grpcPort).toBe(7434);
    expect(cfg.log.level).toBe("info");
    expect(cfg.features.knowledgeEnabled).toBe(true);
    expect(cfg.tuning.reconciliationTickMs).toBe(10_000);
  });

  it("result is frozen (top-level and nested)", () => {
    const cfg = resolveGrackleConfig({ env: {} });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.network)).toBe(true);
    expect(Object.isFrozen(cfg.log)).toBe(true);
  });

  it("passes env through to all sub-resolvers", () => {
    const cfg = resolveGrackleConfig({
      env: {
        GRACKLE_PORT: "9000",
        LOG_LEVEL: "debug",
        GRACKLE_HOME: "/custom",
        GRACKLE_DOCKER_HOST: "myhost",
        GRACKLE_SKIP_ORCHESTRATION: "1",
        GRACKLE_RECONCILIATION_TICK_MS: "2000",
      },
    });
    expect(cfg.network.grpcPort).toBe(9000);
    expect(cfg.log.level).toBe("debug");
    expect(cfg.paths.grackleHome).toBe("/custom");
    expect(cfg.docker.dockerHost).toBe("myhost");
    expect(cfg.features.skipOrchestration).toBe(true);
    expect(cfg.tuning.reconciliationTickMs).toBe(2000);
  });
});
