import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { AgentSession, AgentEvent, CreateSessionOptions } from "@grackle-ai/runtime-sdk";
import { BaseAgentSession, BaseAgentRuntime, convertMcpServers, logger, ensureRuntimeInstalled, importFromRuntime, getRuntimeBinDirectory } from "@grackle-ai/runtime-sdk";

// ─── Configuration ──────────────────────────────────────────

/** Configuration for an ACP-based agent runtime. */
export interface AcpAgentConfig {
  /** Runtime name for registry lookup (e.g., "codex-acp"). */
  name: string;
  /** Command to spawn (e.g., "codex", "copilot", "claude"). */
  command: string;
  /** CLI arguments passed to the agent command (e.g., ["--acp", "--stdio"]). */
  args: string[];
  /** Additional environment variables for the subprocess. */
  env?: Record<string, string>;
}

// ─── Dynamic import ─────────────────────────────────────────

/** @internal SDK module shape — exported only for `_setAcpSdkForTesting`. */
export interface AcpSdkModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ClientSideConnection: new (toClient: (agent: any) => any, stream: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ndJsonStream: (output: any, input: any) => any;
  PROTOCOL_VERSION: number;
}

/** Per-runtime cached SDK import promises to avoid race conditions. */
const sdkPromiseMap: Map<string, Promise<AcpSdkModule>> = new Map();

/** Global mock SDK for testing — when set, all getAcpSdk() calls return this. */
let globalMockSdk: AcpSdkModule | undefined;

/**
 * @internal For testing only — inject a mock SDK to bypass the dynamic import.
 * Pass `undefined` to reset the cache so the real import is attempted again.
 */
export function _setAcpSdkForTesting(mock: AcpSdkModule | undefined): void {
  globalMockSdk = mock;
  sdkPromiseMap.clear();
}

/** Lazily import the ACP SDK for the given runtime, installing packages on demand. */
function getAcpSdk(runtimeName: string): Promise<AcpSdkModule> {
  // Test mock bypass
  if (globalMockSdk) {
    return Promise.resolve(globalMockSdk);
  }

  const existing = sdkPromiseMap.get(runtimeName);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<AcpSdkModule> => {
    try {
      await ensureRuntimeInstalled(runtimeName);
      const mod = await importFromRuntime<Record<string, unknown>>(runtimeName, "@agentclientprotocol/sdk");
      if (typeof mod.ClientSideConnection !== "function") {
        throw new Error("ClientSideConnection not found in @agentclientprotocol/sdk");
      }
      return {
        ClientSideConnection: mod.ClientSideConnection as AcpSdkModule["ClientSideConnection"],
        ndJsonStream: mod.ndJsonStream as AcpSdkModule["ndJsonStream"],
        PROTOCOL_VERSION: (mod.PROTOCOL_VERSION ?? 1) as number,
      };
    } catch (importErr: unknown) {
      sdkPromiseMap.delete(runtimeName);
      const detail = importErr instanceof Error ? importErr.message : String(importErr);
      throw new Error(
        `ACP SDK not installed or failed to load for runtime "${runtimeName}": ${detail}\n` +
        `ACP runtimes are installed in isolated directories (e.g. ~/.grackle/runtimes/${runtimeName}/).\n` +
        "Please check that directory or rerun/repair the runtime installation for this ACP runtime.",
      );
    }
  })();

  sdkPromiseMap.set(runtimeName, promise);
  return promise;
}

// ─── Pure helper functions ──────────────────────────────────

/**
 * Map an ACP SessionUpdate to zero or more AgentEvents.
 *
 * The update is a discriminated union keyed on the `sessionUpdate` field.
 * Only actionable update types are mapped; intermediate progress is skipped.
 */
export function mapSessionUpdate(update: Record<string, unknown>): AgentEvent[] {
  const ts = new Date().toISOString();
  const raw = update;
  const updateType = update.sessionUpdate as string;

  switch (updateType) {
    case "agent_message_chunk": {
      const content = update.content as Record<string, unknown> | undefined;
      if (content?.type === "text") {
        return [{ type: "text", timestamp: ts, content: (content.text || "") as string, raw }];
      }
      return [];
    }

    case "agent_thought_chunk": {
      const content = update.content as Record<string, unknown> | undefined;
      if (content?.type === "text") {
        return [{ type: "text", timestamp: ts, content: `[thinking] ${(content.text || "") as string}`, raw }];
      }
      return [];
    }

    case "tool_call": {
      return [{
        type: "tool_use",
        timestamp: ts,
        content: JSON.stringify({
          tool: (update.title || "unknown") as string,
          args: update.rawInput,
        }),
        raw,
      }];
    }

    case "tool_call_update": {
      const status = update.status as string | undefined;
      if (status === "completed") {
        const output = update.rawOutput !== null && update.rawOutput !== undefined
          ? JSON.stringify(update.rawOutput)
          : ((update.content || "") as string);
        return [{ type: "tool_result", timestamp: ts, content: output, raw }];
      }
      if (status === "failed") {
        const rawOutput = update.rawOutput as Record<string, unknown> | undefined;
        const errorContent = rawOutput?.error ?? update.content ?? "Tool call failed";
        return [{
          type: "tool_result",
          timestamp: ts,
          content: typeof errorContent === "string" ? errorContent : JSON.stringify(errorContent),
          raw,
        }];
      }
      // Skip intermediate progress (pending, in_progress)
      return [];
    }

    case "plan": {
      const entries = (update.entries || []) as Array<Record<string, unknown>>;
      if (entries.length === 0) {
        return [];
      }
      const formatted = entries
        .map((e) => `[${(e.status || "pending") as string}] ${(e.content || "") as string}`)
        .join("\n");
      return [{ type: "system", timestamp: ts, content: formatted, raw }];
    }

    case "usage_update": {
      const cost = update.cost as { amount?: number; currency?: string } | undefined;
      const rawAmount = cost?.currency === "USD" ? Number(cost.amount) : 0;
      const costAmount = Number.isFinite(rawAmount) ? rawAmount : 0;
      if (costAmount > 0) {
        return [{ type: "usage", timestamp: ts, content: JSON.stringify({
          input_tokens: 0, output_tokens: 0, cost_usd: costAmount,
        }), raw }];
      }
      return [];
    }

    default:
      // Skip unrecognized update types (config_option_update, etc.)
      return [];
  }
}

/**
 * Auto-approve an ACP permission request by selecting the first allow option.
 *
 * Prefers `allow_once` or `allow_always` options, falling back to the first option
 * if no allow option is available.
 */
export function autoApprovePermission(
  params: { options: Array<{ optionId: string; kind: string }> },
): { outcome: { outcome: string; optionId: string } } {
  const allowOption = params.options.find(
    (opt) => opt.kind === "allow_once" || opt.kind === "allow_always",
  );
  return {
    outcome: {
      outcome: "selected",
      optionId: (allowOption ?? params.options[0]).optionId,
    },
  };
}

/**
 * Select the first `env_var` auth method from an ACP `initialize` response
 * whose required env vars are all present in the provided environment.
 *
 * Returns the `methodId` string to pass to `connection.authenticate()`, or
 * `undefined` if no matching method is found.
 */
export function selectEnvVarAuthMethod(
  authMethods: Array<Record<string, unknown>>,
  env: Record<string, string | undefined>,
): string | undefined {
  for (const method of authMethods) {
    if (method.type !== "env_var") {
      continue;
    }
    const vars = (method.vars || []) as Array<{ name: string; optional?: boolean }>;
    const allSet = vars.every((v) => v.optional || !!env[v.name]);
    const anyRequired = vars.some((v) => !v.optional);
    if (anyRequired && allSet) {
      return method.id as string;
    }
  }
  return undefined;
}

// ─── Session ────────────────────────────────────────────────

/** An in-progress agent session that communicates via the Agent Client Protocol over stdio. */
class AcpSession extends BaseAgentSession {
  public runtimeName: string;
  protected readonly runtimeDisplayName: string;
  protected readonly noMessagesError: string;

  private readonly config: AcpAgentConfig;
  private child?: ChildProcess;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection?: any;
  private acpSessionId?: string;
  private messageCount: number = 0;
  /** Last cumulative cost reported by usage_update (for delta computation). */
  private lastReportedCost: number = 0;

  public constructor(config: AcpAgentConfig, opts: CreateSessionOptions) {
    super(opts);
    this.config = config;
    this.runtimeName = config.name;
    this.runtimeDisplayName = config.name;
    const fullCommand = [config.command, ...config.args].join(" ");
    this.noMessagesError =
      `${config.name} returned no messages. Check that '${fullCommand}' is installed and supports ACP.`;
  }

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();
    const sdk = await getAcpSdk(this.config.name);

    // Resolve working directory
    const cwd = await this.resolveWorkDir();

    // Resolve MCP servers (shared config + spawn-provided servers + broker)
    const mcpConfig = this.resolveMcp();

    // Spawn agent subprocess in the resolved working directory
    const spawnCwd = cwd || process.cwd();
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    const runtimeBinDir = getRuntimeBinDirectory(this.config.name);
    const childEnv = {
      ...process.env,
      ...this.config.env,
      PATH: `${runtimeBinDir}${pathSeparator}${process.env.PATH || ""}`,
    };
    this.child = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: spawnCwd,
      env: childEnv,
      shell: process.platform === "win32",
    });

    this.eventQueue.push({
      type: "system",
      timestamp: ts(),
      content: `Spawned ${this.config.command} ${this.config.args.join(" ")} (pid: ${String(this.child.pid)}, cwd: ${spawnCwd})`,
    });

    // Register exit/error handlers immediately to catch early termination
    this.child.on("error", (err: Error) => {
      if (!this.killed) {
        this.eventQueue.push({
          type: "error",
          timestamp: ts(),
          content: `Failed to spawn ${this.config.command}: ${err.message}`,
        });
      }
    });

    this.child.on("exit", (code: number | null, signal: string | null) => {
      if (!this.killed) {
        this.eventQueue.push({
          type: "error",
          timestamp: ts(),
          content: `Agent process exited unexpectedly (code: ${String(code)}, signal: ${String(signal)})`,
        });
      }
    });

    // Create ACP stream over stdio
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const stream = sdk.ndJsonStream(
      Writable.toWeb(this.child.stdin!),
      Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>,
    );

    // Create client-side ACP connection with event handlers
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.connection = new sdk.ClientSideConnection(
      () => ({
        sessionUpdate: (params: Record<string, unknown>): void => {
          const update = params.update as Record<string, unknown>;
          const events = mapSessionUpdate(update);
          for (const event of events) {
            // Apply cumulative→delta conversion for ACP usage_update cost
            if (event.type === "usage") {
              try {
                const data = JSON.parse(event.content) as { input_tokens: number; output_tokens: number; cost_usd: number };
                if (data.cost_usd > 0) {
                  const delta = data.cost_usd - this.lastReportedCost;
                  this.lastReportedCost = data.cost_usd;
                  if (delta <= 0) { continue; }
                  this.eventQueue.push({ ...event, content: JSON.stringify({ ...data, cost_usd: delta }) });
                  this.messageCount++;
                  continue;
                }
              } catch { /* fall through to normal push */ }
            }
            this.eventQueue.push(event);
            this.messageCount++;
          }
        },
        requestPermission: async (params: Record<string, unknown>) => {
          return autoApprovePermission(
            params as { options: Array<{ optionId: string; kind: string }> },
          );
        },
      }),
      stream,
    );

    // Initialize ACP protocol
    let initResult: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      initResult = await this.connection.initialize({
        protocolVersion: sdk.PROTOCOL_VERSION,
        clientInfo: { name: "grackle-powerline", version: "1.0.0" },
        clientCapabilities: {},
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      logger.error({ err }, "ACP initialize failed");
      throw new Error(`ACP initialize failed: ${message}`);
    }

    this.eventQueue.push({
      type: "system",
      timestamp: ts(),
      content: "ACP connection initialized",
    });

    // Some ACP bridges (e.g. @github/copilot) require an explicit authenticate()
    // call even when credential files are on disk. Attempt auth with the first
    // env_var method whose required vars are present in the subprocess environment.
    const envVarMethodId = selectEnvVarAuthMethod(
      (initResult.authMethods || []) as Array<Record<string, unknown>>,
      process.env,
    );
    if (envVarMethodId) {
      try {
        await this.connection.authenticate({ methodId: envVarMethodId });
        this.eventQueue.push({
          type: "system",
          timestamp: ts(),
          content: `ACP authenticated via ${envVarMethodId}`,
        });
      } catch (err: unknown) {
        // Non-fatal: bridge may not require this call (claude-code-acp, codex-acp)
        logger.warn({ err, methodId: envVarMethodId }, "ACP authenticate() failed — continuing");
      }
    }

    // Create a new ACP session (or reuse existing for resume)
    if (this.resumeSessionId) {
      this.acpSessionId = this.resumeSessionId;
      this.setRuntimeSessionId(this.resumeSessionId);
      this.eventQueue.push({
        type: "system",
        timestamp: ts(),
        content: `ACP session resuming (id: ${this.runtimeSessionId})`,
      });
      return;
    }

    let sessionResult: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sessionResult = await this.connection.newSession({
        cwd: spawnCwd,
        mcpServers: convertMcpServers(mcpConfig.servers),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      logger.error({ err }, "ACP newSession failed");
      throw new Error(`ACP newSession failed: ${message}`);
    }

    this.acpSessionId = sessionResult.sessionId as string;
    this.setRuntimeSessionId(this.acpSessionId || "");

    this.eventQueue.push({
      type: "system",
      timestamp: ts(),
      content: `ACP session created (id: ${this.runtimeSessionId})`,
    });

    // Set model if specified
    if (this.model) {
      try {
        await this.connection.unstable_setSessionModel({
          sessionId: this.acpSessionId,
          modelId: this.model,
        });
      } catch {
        try {
          await this.connection.setSessionConfigOption({
            sessionId: this.acpSessionId,
            configId: "model",
            value: this.model,
          });
        } catch {
          logger.warn({ model: this.model }, "Failed to set model via ACP");
        }
      }
    }

  }

  protected async setupForResume(): Promise<void> {
    // setupSdk() already handled resume by setting acpSessionId = resumeSessionId
    await super.setupForResume();
  }

  protected async runInitialQuery(prompt: string): Promise<number> {
    this.messageCount = 0;
    try {
      await this.connection.prompt({
        sessionId: this.acpSessionId,
        prompt: [{ type: "text", text: prompt }],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      logger.error({ err }, "ACP prompt failed");
      throw new Error(`ACP prompt failed: ${message}`);
    }
    return this.messageCount;
  }

  protected async executeFollowUp(text: string): Promise<void> {
    this.messageCount = 0;
    await this.connection.prompt({
      sessionId: this.acpSessionId,
      prompt: [{ type: "text", text }],
    });
  }

  protected canAcceptInput(): boolean {
    return !!this.connection && !!this.acpSessionId;
  }

  protected abortActive(): void {
    if (this.connection && this.acpSessionId) {
      (this.connection.cancel({ sessionId: this.acpSessionId }) as Promise<void>).catch(() => {});
    }
  }

  /** Forcefully terminate the session and subprocess. */
  public override kill(): void {
    // Cancel ACP session before super.kill() calls abortActive()
    if (this.connection && this.acpSessionId) {
      (this.connection.cancel({ sessionId: this.acpSessionId }) as Promise<void>).catch(() => {});
    }
    // Kill the subprocess
    if (this.child) {
      this.child.kill("SIGTERM");
    }
    // Delegate to base: sets killed, closes queue, calls releaseResources
    super.kill();
  }

  protected override releaseResources(): void {
    this.connection = undefined;
    this.child = undefined;
  }
}

// ─── Runtime ────────────────────────────────────────────────

/** Runtime that delegates to an agent CLI via the Agent Client Protocol (ACP) over stdio. */
export class AcpRuntime extends BaseAgentRuntime {
  public name: string;
  private readonly config: AcpAgentConfig;

  public constructor(config: AcpAgentConfig) {
    super();
    this.name = config.name;
    this.config = config;
  }

  protected createSession(opts: CreateSessionOptions): AgentSession {
    return new AcpSession(this.config, opts);
  }
}
