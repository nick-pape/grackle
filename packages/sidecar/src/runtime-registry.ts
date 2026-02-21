import type { AgentRuntime } from "./runtimes/runtime.js";

const runtimes = new Map<string, AgentRuntime>();

/** Register an agent runtime so it can be looked up by name. */
export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.name, runtime);
}

/** Retrieve a registered runtime by name. */
export function getRuntime(name: string): AgentRuntime | undefined {
  return runtimes.get(name);
}

/** Return the names of all registered runtimes. */
export function listRuntimes(): string[] {
  return Array.from(runtimes.keys());
}
