import { spawn as spawnProcess } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { logger } from "../logger.js";

/** Shape of the JSON result from genaiscript's res.json output. */
interface GenAIResult {
  status: string;
  statusText?: string;
  text?: string;
  annotations?: Array<{ severity?: string; message?: string }>;
}

/**
 * Resolve the path to the genaiscript CLI entry point (CJS bundle).
 * Uses require.resolve to find the package through pnpm's hoisted node_modules.
 */
function resolveGenAIScriptBin(): string {
  const esmRequire = createRequire(import.meta.url);
  const pkgPath = esmRequire.resolve("genaiscript/package.json");
  const pkgDir = dirname(pkgPath);
  const pkg = esmRequire(pkgPath) as { bin?: Record<string, string> | string };
  const binRelative = typeof pkg.bin === "string"
    ? pkg.bin
    : (pkg.bin?.genaiscript ?? "built/genaiscript.cjs");
  return join(pkgDir, binRelative);
}

/**
 * A session that executes a GenAIScript (.genai.mjs) program via the CLI.
 *
 * Stderr is streamed as text events in real-time (progress, console.log).
 * The structured result is written to `res.json` via the `-o` flag and
 * post-processed into tool_use/tool_result events on completion.
 */
class GenAIScriptSession implements AgentSession {
  public id: string;
  public runtimeName: string = "genaiscript";
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  private scriptContent: string;
  private mcpBroker: { url: string; token: string } | undefined;
  private child: ChildProcess | null = null;
  private killed: boolean = false;
  private tmpDir: string | null = null;

  public constructor(opts: SpawnOptions) {
    this.id = opts.sessionId;
    this.runtimeSessionId = `genaiscript-${opts.sessionId}`;
    this.scriptContent = opts.scriptContent || "";
    this.mcpBroker = opts.mcpBroker;
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

    if (!this.scriptContent) {
      yield { type: "error", timestamp: ts(), content: "No script content provided" };
      this.status = SESSION_STATUS.FAILED;
      yield { type: "status", timestamp: ts(), content: "failed" };
      return;
    }

    this.tmpDir = await mkdtemp(join(tmpdir(), "genaiscript-"));
    const scriptPath = join(this.tmpDir, `${this.id}.genai.mjs`);
    const outputDir = join(this.tmpDir, "output");

    try {
      await writeFile(scriptPath, this.scriptContent, "utf8");

      // Use -o to write structured result to outputDir/res.json
      const args = ["run", scriptPath, "-o", outputDir];

      // Inject MCP broker URL via GENAISCRIPT_VAR_ env vars so scripts can access
      // them as `env.vars.GRACKLE_MCP_URL` / `env.vars.GRACKLE_MCP_TOKEN`.
      const childEnv: Record<string, string | undefined> = { ...process.env };
      if (this.mcpBroker) {
        childEnv.GENAISCRIPT_VAR_GRACKLE_MCP_URL = this.mcpBroker.url;
        childEnv.GENAISCRIPT_VAR_GRACKLE_MCP_TOKEN = this.mcpBroker.token;
      }

      const genaiscriptBin = resolveGenAIScriptBin();
      logger.info({ sessionId: this.id, scriptPath, genaiscriptBin }, "genaiscript: spawning");

      yield { type: "system", timestamp: ts(), content: "Starting GenAIScript..." };

      this.child = spawnProcess(process.execPath, [genaiscriptBin, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });

      // Stream stderr lines as text events (progress, console.log output)
      const stderrReader = createInterface({ input: this.child.stderr! });

      for await (const line of stderrReader) {
        if (this.killed) {
          break;
        }
        if (!line.trim()) {
          continue;
        }
        yield { type: "system", timestamp: ts(), content: line };
      }

      // Wait for process exit
      const exitCode = await new Promise<number>((resolve) => {
        if (this.child!.exitCode !== null) {
          resolve(this.child!.exitCode);
          return;
        }
        this.child!.on("close", (code: number | null) => {
          resolve(code ?? 1);
        });
      });

      if (this.killed) {
        this.status = SESSION_STATUS.INTERRUPTED;
        yield { type: "status", timestamp: ts(), content: "interrupted" };
        return;
      }

      // Parse the structured result from res.json
      let result: GenAIResult | undefined;
      try {
        const resJson = await readFile(join(outputDir, "res.json"), "utf8");
        result = JSON.parse(resJson) as GenAIResult;
      } catch {
        logger.warn({ sessionId: this.id, outputDir }, "genaiscript: res.json not found or invalid");
      }

      yield { type: "system", timestamp: ts(), content: "GenAIScript finished" };

      // Yield the script's output text — this is the LLM response or script result
      if (result?.text) {
        yield { type: "text", timestamp: ts(), content: result.text };
      }

      // Yield any annotations (warnings/errors from the script)
      if (result?.annotations) {
        for (const ann of result.annotations) {
          const severity = ann.severity ?? "info";
          const message = ann.message ?? JSON.stringify(ann);
          yield {
            type: severity === "error" ? "error" : "text",
            timestamp: ts(),
            content: `[${severity}] ${message}`,
          };
        }
      }

      // Final status
      if (exitCode === 0 || result?.status === "success") {
        this.status = SESSION_STATUS.COMPLETED;
        yield { type: "status", timestamp: ts(), content: "completed" };
      } else {
        const errorText = result?.statusText ?? result?.status ?? `Process exited with code ${exitCode}`;
        yield { type: "error", timestamp: ts(), content: String(errorText) };
        this.status = SESSION_STATUS.FAILED;
        yield { type: "status", timestamp: ts(), content: "failed" };
      }
    } catch (err) {
      yield { type: "error", timestamp: ts(), content: err instanceof Error ? err.message : String(err) };
      this.status = SESSION_STATUS.FAILED;
      yield { type: "status", timestamp: ts(), content: "failed" };
    } finally {
      if (this.tmpDir) {
        try { await rm(this.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  public sendInput(_text: string): void {
    logger.warn({ sessionId: this.id }, "GenAIScript sessions do not accept interactive input");
  }

  public kill(): void {
    this.killed = true;
    this.status = SESSION_STATUS.INTERRUPTED;
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}

/**
 * Runtime for GenAIScript — executes .genai.mjs scripts via the CLI,
 * streaming stderr progress in real-time and parsing the structured
 * JSON result into agent-style events (text, tool_use, tool_result).
 */
export class GenAIScriptRuntime implements AgentRuntime {
  public name: string = "genaiscript";

  public spawn(opts: SpawnOptions): AgentSession {
    return new GenAIScriptSession(opts);
  }

  public resume(_opts: ResumeOptions): AgentSession {
    throw new Error("GenAIScript sessions cannot be resumed");
  }
}
