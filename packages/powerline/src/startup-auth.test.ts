import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dirname, "..", "dist", "index.js");

/** Run the PowerLine CLI with the given args and env, returning exit code and combined output. */
function runPowerLine(args: string[], env?: Record<string, string>): { exitCode: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [ENTRY_POINT, ...args], {
      env: { ...process.env, ...env, GRACKLE_POWERLINE_TOKEN: undefined },
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { exitCode: 0, output: stdout };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { exitCode: e.status, output: (e.stdout || "") + (e.stderr || "") };
  }
}

describe("PowerLine startup authentication", () => {
  it("exits with error when no token and no --no-auth", () => {
    const { exitCode, output } = runPowerLine(["--port", "0"]);
    expect(exitCode).not.toBe(0);
    expect(output).toContain("No authentication token provided");
  });

  it("exits with error when GRACKLE_POWERLINE_TOKEN is empty and no --no-auth", () => {
    const { exitCode, output } = runPowerLine(["--port", "0"], { GRACKLE_POWERLINE_TOKEN: "" });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("No authentication token provided");
  });

  it("does not error when --no-auth is passed", () => {
    const { output } = runPowerLine(["--port", "0", "--no-auth"]);
    // Port 0 may cause a bind error, but the auth check should NOT fire
    expect(output).not.toContain("No authentication token provided");
  });

  it("does not error when --token is provided", () => {
    const { output } = runPowerLine(["--port", "0", "--token", "test-secret"]);
    expect(output).not.toContain("No authentication token provided");
  });
});
