// ─── Runtime Package Manifest ───────────────────────────────
// Static mapping of runtime name → npm packages + versions.
// Lives in @grackle-ai/common so both PowerLine and adapter-sdk can use it.

/** Describes the npm packages required for a specific agent runtime. */
export interface RuntimePackageManifest {
  /** Map of npm package name → semver range. */
  packages: Record<string, string>;
  /** When true, registers a module resolve hook for vscode-jsonrpc/node (copilot only). */
  needsJsonRpcHook?: boolean;
}

/**
 * Static manifest of all supported agent runtimes and their npm dependencies.
 *
 * Each entry maps a runtime name (as used in the registry) to the packages
 * that must be installed for that runtime to function. These packages are
 * installed lazily at spawn time into isolated per-runtime directories.
 */
export const RUNTIME_MANIFESTS: Readonly<Record<string, RuntimePackageManifest>> = {
  "claude-code": {
    packages: { "@anthropic-ai/claude-agent-sdk": "^0.2.50" },
  },
  "copilot": {
    packages: { "@github/copilot-sdk": "^0.1.29", "@github/copilot": "^1.0.7" },
    needsJsonRpcHook: true,
  },
  "codex": {
    packages: { "@openai/codex-sdk": "^0.111.0" },
  },
  "goose": {
    packages: { "@agentclientprotocol/sdk": "^0.16.1" },
  },
  "codex-acp": {
    packages: { "@agentclientprotocol/sdk": "^0.16.1", "@zed-industries/codex-acp": "^0.10.0" },
  },
  "copilot-acp": {
    packages: { "@agentclientprotocol/sdk": "^0.16.1", "@github/copilot": "^1.0.7" },
  },
  "claude-code-acp": {
    packages: { "@agentclientprotocol/sdk": "^0.16.1", "@zed-industries/claude-agent-acp": "^0.22.0" },
  },
  "genaiscript": {
    packages: { "genaiscript": "^2.5.1" },
  },
};
