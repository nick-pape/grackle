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
    install: { packages: { "@anthropic-ai/claude-agent-sdk": "^0.2.50" } },
  },
  "copilot": {
    displayName: "GitHub Copilot",
    description: "GitHub Copilot via the Copilot SDK.",
    models: [{ id: "gpt-4o", name: "GPT-4o", provider: "copilot" }],
    install: {
      packages: { "@github/copilot-sdk": "^0.1.29", "@github/copilot": "^1.0.43" },
      needsJsonRpcHook: true,
    },
  },
  "codex": {
    displayName: "Codex",
    description: "OpenAI Codex via the Codex SDK.",
    models: [{ id: "o3", name: "OpenAI o3", provider: "codex" }],
    install: { packages: { "@openai/codex-sdk": "^0.111.0" } },
  },
  "goose": {
    displayName: "Goose",
    description: "Block Goose via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.16.1" } },
  },
  "codex-acp": {
    displayName: "Codex (ACP)",
    description: "OpenAI Codex via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.16.1", "@zed-industries/codex-acp": "^0.10.0" } },
  },
  "copilot-acp": {
    displayName: "Copilot (ACP)",
    description: "GitHub Copilot via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.16.1", "@github/copilot": "^1.0.43" } },
  },
  "claude-code-acp": {
    displayName: "Claude Code (ACP)",
    description: "Claude Code via the Agent Client Protocol (experimental).",
    models: [],
    install: { packages: { "@agentclientprotocol/sdk": "^0.16.1", "@zed-industries/claude-agent-acp": "^0.22.0" } },
  },
  "genaiscript": {
    displayName: "GenAIScript",
    description: "GenAIScript CLI scripting runtime.",
    models: [],
    install: { packages: { "genaiscript": "^2.5.1" } },
  },
  "stub": {
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
