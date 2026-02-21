import type { AgentRuntime } from "./runtimes/runtime.js";

const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.name, runtime);
}

export function getRuntime(name: string): AgentRuntime | undefined {
  return runtimes.get(name);
}

export function listRuntimes(): string[] {
  return Array.from(runtimes.keys());
}
