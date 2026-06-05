// ─── Runtime Catalog ────────────────────────────────────────
// The canonical, product-level registry of agent runtimes Grackle offers.
// Lives in @grackle-ai/common so PowerLine, the Server, adapter-sdk, and the
// CLI all source the same list. This is the data behind the AHP root channel's
// `RootState.agents` (each entry ≡ AHP `AgentInfo`, minus the server-derived
// `protectedResources`, which depend on the user's credential config).
//
// Availability is NOT host-reported: PowerLine lazily npm-installs any runtime's
// packages on demand (see `@grackle-ai/runtime-sdk` runtime-installer), so every
// host can serve the whole catalog. "Available" = "in the catalog."

/** Describes the npm packages required for a specific agent runtime. */
export interface RuntimePackageManifest {
  /** Map of npm package name → semver range. */
  packages: Record<string, string>;
  /** When true, registers a module resolve hook for vscode-jsonrpc/node (copilot only). */
  needsJsonRpcHook?: boolean;
}

/**
 * Minimal model metadata for a runtime, mirroring AHP `SessionModelInfo`.
 * Rich metadata (config schema, context window, vision) is deferred.
 */
export interface RuntimeModelInfo {
  /** Model identifier passed at spawn time (e.g. `"sonnet"`). */
  id: string;
  /** Human-readable model name. */
  name: string;
  /** Provider this model belongs to (the runtime name). */
  provider: string;
}

// ─── Factory Descriptors ───────────────────────────────────
// Describe how to instantiate a runtime. PowerLine's runtime-loader reads
// these to dynamically import and construct each runtime — no hardcoded
// imports or registration calls.

/** Import a class from a workspace/npm package and call `new Class()`. */
export interface SdkRuntimeFactory {
  /** Discriminant. */
  type: "sdk";
  /** npm package name to import (e.g. `"@grackle-ai/runtime-claude-code"`). */
  package: string;
  /** Named export of the runtime class (e.g. `"ClaudeCodeRuntime"`). */
  exportName: string;
}

/** Serializable ACP agent config (no `name` — the catalog key IS the name). */
export interface AcpRuntimeFactoryConfig {
  /** CLI command to spawn (e.g. `"goose"`, `"claude-agent-acp"`). */
  command: string;
  /** CLI arguments. */
  args: string[];
  /** Isolate `~/.claude` config for headless agents. */
  isolateClaudeConfig?: boolean;
}

/** Import `AcpRuntime` from `@grackle-ai/runtime-acp` and pass config. */
export interface AcpRuntimeFactory {
  /** Discriminant. */
  type: "acp";
  /** ACP agent config passed to `new AcpRuntime({ name, ...config })`. */
  config: AcpRuntimeFactoryConfig;
}

/**
 * Discriminated union describing how to instantiate a runtime.
 *
 * - `"sdk"` — import a class from a workspace package, call `new Class()`
 * - `"acp"` — import `AcpRuntime`, pass per-agent config
 */
export type RuntimeFactoryDescriptor = SdkRuntimeFactory | AcpRuntimeFactory;

/**
 * A single runtime in the catalog. Mirrors AHP `AgentInfo` (presentation +
 * models); `install` is the lazy-install spec (absent for built-in/test
 * runtimes that need no npm packages).
 */
export interface RuntimeCatalogEntry {
  /** Human-readable name. */
  displayName: string;
  /** Short description string. */
  description: string;
  /** Selectable models for this runtime (minimal metadata). */
  models: RuntimeModelInfo[];
  /** npm packages to lazily install for this runtime; omitted for built-ins. */
  install?: RuntimePackageManifest;
  /** How to instantiate this runtime; absent for local-only runtimes (stubs). */
  factory?: RuntimeFactoryDescriptor;
}

/**
 * The canonical catalog of agent runtimes, keyed by runtime name (the same name
 * used by the PowerLine runtime registry and persona `runtime` field).
 */
export const RUNTIME_CATALOG: Readonly<Record<string, RuntimeCatalogEntry>> = {
  "claude-code": {
    displayName: "Claude Code",
    description: "Anthropic Claude via the Claude Agent SDK.",
    models: [
      { id: "sonnet", name: "Claude Sonnet", provider: "claude-code" },
      { id: "opus", name: "Claude Opus", provider: "claude-code" },
      { id: "haiku", name: "Claude Haiku", provider: "claude-code" },
    ],
    install: { packages: { "@anthropic-ai/claude-agent-sdk": "^0.3.0" } },
    factory: {
      type: "sdk",
      package: "@grackle-ai/runtime-claude-code",
      exportName: "ClaudeCodeRuntime",
    },
  },
  copilot: {
    displayName: "GitHub Copilot",
    description: "GitHub Copilot via the Copilot SDK.",
    models: [{ id: "gpt-4o", name: "GPT-4o", provider: "copilot" }],
    install: {
      packages: { "@github/copilot-sdk": "^1.0.0", "@github/copilot": "^1.0.43" },
      needsJsonRpcHook: true,
    },
    factory: { type: "sdk", package: "@grackle-ai/runtime-copilot", exportName: "CopilotRuntime" },
  },
  codex: {
    displayName: "Codex",
    description: "OpenAI Codex via the Codex SDK.",
    models: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "codex" }],
    install: { packages: { "@openai/codex-sdk": "^0.136.0" } },
    factory: { type: "sdk", package: "@grackle-ai/runtime-codex", exportName: "CodexRuntime" },
  },
  goose: {
    displayName: "Goose",
    description: "Block Goose via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.24.0" } },
    factory: { type: "acp", config: { command: "goose", args: ["acp"] } },
  },
  "codex-acp": {
    displayName: "Codex (ACP)",
    description: "OpenAI Codex via the Agent Client Protocol (experimental).",
    models: [],
    install: {
      packages: { "@agentclientprotocol/sdk": "^0.24.0", "@zed-industries/codex-acp": "^0.15.0" },
    },
    factory: { type: "acp", config: { command: "codex-acp", args: [] } },
  },
  "copilot-acp": {
    displayName: "Copilot (ACP)",
    description: "GitHub Copilot via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.24.0", "@github/copilot": "^1.0.43" } },
    factory: { type: "acp", config: { command: "copilot", args: ["--acp", "--stdio"] } },
  },
  "claude-code-acp": {
    displayName: "Claude Code (ACP)",
    description: "Claude Code via the Agent Client Protocol (experimental).",
    models: [],
    install: {
      packages: {
        "@agentclientprotocol/sdk": "^0.24.0",
        "@zed-industries/claude-agent-acp": "^0.23.0",
      },
    },
    factory: {
      type: "acp",
      config: { command: "claude-agent-acp", args: [], isolateClaudeConfig: true },
    },
  },
  genaiscript: {
    displayName: "GenAIScript",
    description: "GenAIScript CLI scripting runtime.",
    models: [],
    install: { packages: { genaiscript: "^2.5.1" } },
    factory: {
      type: "sdk",
      package: "@grackle-ai/runtime-genaiscript",
      exportName: "GenAIScriptRuntime",
    },
  },
  stub: {
    displayName: "Stub",
    description: "In-process test stub runtime.",
    models: [],
  },
  "stub-mcp": {
    displayName: "Stub (MCP)",
    description: "Test stub runtime with MCP wiring.",
    models: [],
  },
};
