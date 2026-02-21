import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FullConfig } from "@playwright/test";

const STATE_FILE = join(tmpdir(), "grackle-e2e-state.json");

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  let state: { grackleHome: string; sidecarPid: number; serverPid: number };

  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    console.log("[e2e] No state file found, nothing to tear down");
    return;
  }

  // Kill server + sidecar
  for (const pid of [state.serverPid, state.sidecarPid]) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`[e2e] Killed process ${pid}`);
    } catch {
      // Process may already be dead
    }
  }

  // Small delay to let processes exit
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Remove temp directory
  try {
    rmSync(state.grackleHome, { recursive: true, force: true });
    console.log(`[e2e] Removed temp dir: ${state.grackleHome}`);
  } catch {
    console.warn(`[e2e] Could not remove temp dir: ${state.grackleHome}`);
  }

  // Remove state file
  try {
    rmSync(STATE_FILE);
  } catch { /* ignore */ }

  console.log("[e2e] Teardown complete");
}
