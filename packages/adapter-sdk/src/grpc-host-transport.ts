/**
 * gRPC-backed implementation of {@link IHostTransport} (AHP HR8c).
 *
 * Wraps a {@link PowerLineClient} (ConnectRPC client) and folds each
 * incoming `AgentEvent` through the {@link mapAgentEvent} mapper to produce
 * AHP `StateAction[]`. Per-session {@link MapperContext} state is kept inside
 * this instance so consumers don't need to thread it through their code.
 *
 * @module grpc-host-transport
 */

import { create } from "@bufbuild/protobuf";
import { powerline, mapAgentEvent, type MapperContext } from "@grackle-ai/common";
import type { PowerLineClient } from "./adapter.js";
import type {
  AuthenticateParams,
  CreateSessionParams,
  CreateSessionResult,
  HostSessionInfo,
  IHostTransport,
  ReanimateParams,
  ServerActionEnvelope,
} from "./host-transport.js";

/**
 * gRPC-backed {@link IHostTransport} for a single environment.
 *
 * Lifecycle: one instance per `PowerLineConnection`. The mapper context map
 * is keyed by session URI so multiple sessions on the same environment each
 * get their own turn/tool tracking.
 */
export class GrpcHostTransport implements IHostTransport {
  /** Underlying ConnectRPC client for the PowerLine gRPC service. */
  private readonly client: PowerLineClient;

  /**
   * Per-session mapper context. Created lazily on first event per session;
   * cleaned up when the session's stream completes or errors.
   */
  private readonly mapperContexts: Map<string, MapperContext> = new Map();

  /**
   * Create a new gRPC-backed host transport.
   *
   * @param client - The ConnectRPC client to wrap. Typically obtained from
   *   {@link createPowerLineClient} or a `PowerLineConnection`.
   */
  public constructor(client: PowerLineClient) {
    this.client = client;
  }

  /**
   * Create a new session via PowerLine's `spawn` RPC.
   *
   * Returns the session URI plus a live stream of {@link ServerActionEnvelope}s.
   * The stream is mapped from the underlying `AgentEvent` stream.
   */
  public createSession(params: CreateSessionParams): CreateSessionResult {
    const spawnReq = create(powerline.SpawnRequestSchema, {
      sessionId: params.sessionId,
      runtime: params.runtime,
      prompt: params.prompt,
      model: params.model,
      maxTurns: params.maxTurns,
      branch: params.branch,
      workingDirectory: params.workingDirectory,
      systemContext: params.systemContext,
      workspaceId: params.workspaceId,
      taskId: params.taskId,
      mcpServersJson: params.mcpServersJson,
      mcpUrl: params.mcpUrl,
      mcpToken: params.mcpToken,
      useWorktrees: params.useWorktrees,
      pipe: params.pipe ?? "",
      scriptContent: params.scriptContent ?? "",
    });

    const grpcStream = this.client.spawn(spawnReq);
    return {
      sessionUri: params.sessionId,
      stream: this.foldStream(params.sessionId, grpcStream),
    };
  }

  /**
   * Reanimate a suspended session via PowerLine's `resume` RPC.
   *
   * Returns a live stream of envelopes for the reanimated session. Note that
   * `resume` alone does NOT replay buffered events — call
   * {@link IHostTransport.drainBuffered} first to replay the parked queue,
   * then this method to start the live stream.
   */
  public reanimate(params: ReanimateParams): AsyncIterable<ServerActionEnvelope> {
    const resumeReq = create(powerline.ResumeRequestSchema, {
      sessionId: params.sessionId,
      runtimeSessionId: params.runtimeSessionId,
      runtime: params.runtime,
    });
    const grpcStream = this.client.resume(resumeReq);
    return this.foldStream(params.sessionId, grpcStream);
  }

  /**
   * Drain previously-parked buffered events for a session.
   *
   * Maps to the gRPC `drainBufferedEvents` RPC. The returned stream yields
   * the buffered envelopes and then terminates — it does NOT continue into
   * the live event stream. Callers compose `drainBuffered` + `reanimate`
   * to do recovery.
   */
  public async *drainBuffered(sessionUri: string): AsyncIterable<ServerActionEnvelope> {
    const drainReq = create(powerline.DrainRequestSchema, {
      sessionId: sessionUri,
    });
    const drainStream = this.client.drainBufferedEvents(drainReq);
    yield* this.foldStream(sessionUri, drainStream);
  }

  /** Send input text to a session via PowerLine's `sendInput` RPC. */
  public async dispatchInput(sessionUri: string, text: string): Promise<void> {
    await this.client.sendInput(
      create(powerline.InputMessageSchema, { sessionId: sessionUri, text }),
    );
  }

  /** Authenticate credentials via PowerLine's `authenticate` RPC. */
  public async authenticate(params: AuthenticateParams): Promise<void> {
    await this.client.authenticate(
      create(powerline.AuthenticateRequestSchema, {
        provider: params.provider,
        tokens: params.tokens.map((t) =>
          create(powerline.TokenItemSchema, {
            name: t.name,
            type: t.type,
            envVar: t.envVar ?? "",
            filePath: t.filePath ?? "",
            value: t.value,
          }),
        ),
      }),
    );
  }

  /** Dispose a session via PowerLine's `kill` RPC. */
  public async dispose(sessionUri: string, reason?: string): Promise<void> {
    await this.client.kill(
      create(powerline.KillRequestSchema, { id: sessionUri, reason: reason ?? "" }),
    );
    this.mapperContexts.delete(sessionUri);
  }

  /** List active sessions via PowerLine's `listSessions` RPC. */
  public async listSessions(): Promise<HostSessionInfo[]> {
    const list = await this.client.listSessions({});
    return list.sessions.map((s) => ({
      sessionId: s.sessionId,
      runtime: s.runtime,
      status: s.status,
    }));
  }

  /**
   * Fold a raw `AgentEvent` stream into `ServerActionEnvelope`s by running
   * each event through the mapper. The per-session `MapperContext` is
   * created/retrieved lazily and removed when the stream completes.
   */
  private async *foldStream(
    sessionUri: string,
    grpcStream: AsyncIterable<powerline.AgentEvent>,
  ): AsyncIterable<ServerActionEnvelope> {
    const context = this.getOrCreateContext(sessionUri);
    try {
      for await (const event of grpcStream) {
        const idx = context.eventIndex++;
        const { actions } = mapAgentEvent(event, idx, context);
        yield { event, actions };
      }
    } finally {
      // Context lifetime tracks the stream; recover paths create a fresh one
      // on the next drainBuffered/reanimate. Clearing here prevents memory
      // growth for sessions that close cleanly.
      this.mapperContexts.delete(sessionUri);
    }
  }

  /** Get an existing or create a fresh `MapperContext` for a session. */
  private getOrCreateContext(sessionUri: string): MapperContext {
    let ctx = this.mapperContexts.get(sessionUri);
    if (!ctx) {
      ctx = {
        turnId: undefined,
        openToolCalls: [],
        partCounter: 0,
        eventIndex: 0,
        metaAccumulator: {},
      };
      this.mapperContexts.set(sessionUri, ctx);
    }
    return ctx;
  }
}
