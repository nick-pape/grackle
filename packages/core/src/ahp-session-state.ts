/**
 * Session state manager (AHP HR1b / RFC #1292).
 *
 * Wraps the agent-event mapper, AHP sessionReducer, and snapshot store into
 * a single per-session class. Each instance maintains the live `SessionState`
 * by folding mapped actions through the reducer, and persists checkpoints to
 * the `session_snapshots` table.
 *
 * @module ahp-session-state
 */

import { create } from "@bufbuild/protobuf";
import { logger } from "./logger.js";
import { powerline } from "@grackle-ai/common";
import {
  sessionReducer,
  SessionLifecycle,
  SessionStatus,
  type SessionState,
} from "@grackle-ai/ahp";
// SessionAction is a session-specific subset of StateAction, exported as a TypeScript-only
// union from the vendor source. It is not re-exported from the public API.
// This import is types-only and scoped to this package's internal build — consumers of
// @grackle-ai/core never see it since .d.ts resolution is confined to dist/.
import type { SessionAction } from "@grackle-ai/ahp/src/vendor/ahp/action-origin.generated.js";
import { mapAgentEvent, type MapperContext } from "./ahp-mapper.js";
import {
  persistSnapshot as dbPersistSnapshot,
  querySnapshot as dbQuerySnapshot,
  querySessionActions as dbQuerySessionActions,
  type SessionActionQuery,
  type SessionActionRow,
  type SnapshotRecord,
  type SessionSnapshotRow,
} from "@grackle-ai/database";

/** Default flush interval (actions between snapshots). */
const DEFAULT_SNAPSHOT_THRESHOLD: number = 100;

/**
 * Hard cap on events replayed during reconstruction.
 * Must not exceed `MAX_SESSION_ACTION_LIMIT` (5 000) from `@grackle-ai/database`
 * or `querySessionActions` will silently truncate and reconstruction will be
 * incomplete. Paging support can raise this ceiling in a future iteration.
 */
const MAX_RECONSTRUCTION_EVENTS: number = 5_000;

/**
 * Persistence interface for `SessionStateManager`.
 *
 * Injecting a custom implementation lets unit and integration tests exercise
 * the full processEvent → snapshot → reconstruct pipeline against an in-memory
 * store instead of a real SQLite database.
 */
export interface SessionStore {
  /** Persist a snapshot of the current `SessionState` and `MapperContext`. */
  persistSnapshot(record: SnapshotRecord): void;
  /** Load the latest snapshot(s) for a session, newest first. */
  querySnapshot(sessionId: string, limit?: number): SessionSnapshotRow[];
  /** Load session actions for replay, oldest first. */
  querySessionActions(query: SessionActionQuery): SessionActionRow[];
}

/** Default store backed by the real SQLite database. */
const defaultStore: SessionStore = {
  persistSnapshot: dbPersistSnapshot,
  querySnapshot: dbQuerySnapshot,
  querySessionActions: dbQuerySessionActions,
};

/**
 * Callback for snapshot results.
 */
export interface SnapshotResult {
  /** Whether a snapshot was persisted. */
  persisted: boolean;
  /** The ULID of the last action included, or `undefined` if nothing was saved. */
  lastSeq?: string;
}

/**
 * Options for creating a `SessionStateManager`.
 */
export interface SessionStateManagerOptions {
  /** Initial `SessionState` from a prior reconstruction (skips `createInitialState`). */
  initialSnapshot?: SessionState;
  /**
   * Custom persistence store. Defaults to the real SQLite-backed store.
   * Pass an in-memory implementation for testing.
   */
  store?: SessionStore;
}

/**
 * Per-session state manager that processes AgentEvents through the AHP mapper
 * and reducer, maintains live SessionState, and persists periodic snapshots.
 */
export class SessionStateManager {
  /** The current SessionState (built by folding mapped actions). */
  private state: SessionState;

  /** Mapper context maintained across events in the stream. */
  private context: MapperContext;

  /** Current session ID. */
  private sessionId: string;

  /** Number of actions since last snapshot flush. */
  private actionCountSinceLastFlush: number;

  /** Persistence store (real DB by default; injectable for tests). */
  private store: SessionStore;

  /**
   * Number of actions between automatic snapshot flushes.
   * Set to `0` to disable count-based flushing only; event-triggered
   * flushes (turn_complete, terminal status, shutdown) still occur.
   */
  public snapshotThreshold: number;

  /**
   * Set to true when the initial prompt is injected as turn_started.
   * The first runtime turn_started for the same turn is then skipped
   * to avoid a duplicate SessionTurnStarted action.
   */
  private injectedInitialTurn: boolean;

  /**
   * Create a new SessionStateManager.
   *
   * @param sessionId - The session ID to manage.
   * @param options - Optional initial snapshot and persistence store.
   */
  public constructor(sessionId: string, options?: SessionStateManagerOptions) {
    this.sessionId = sessionId;
    this.actionCountSinceLastFlush = 0;
    this.snapshotThreshold = DEFAULT_SNAPSHOT_THRESHOLD;
    this.injectedInitialTurn = false;
    this.store = options?.store ?? defaultStore;
    this.context = {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      eventIndex: 0,
      metaAccumulator: {},
    };

    if (options?.initialSnapshot) {
      this.state = options.initialSnapshot;
    } else {
      this.state = this.createInitialState();
    }
  }

  /**
   * Process a single AgentEvent through the mapper and reducer,
   * and flush a snapshot if the threshold or turn_complete is reached.
   *
   * @param event - The AgentEvent to process.
   * @param serverSeq - Monotonic ULID of the session_action record for this event.
   *   Used to anchor snapshots to the real action sequence for reconstruction.
   * @returns The last action's ULID included in the snapshot, or `undefined`
   *   if no actions were produced or the threshold was not reached.
   */
  public processEvent(event: powerline.AgentEvent, serverSeq: string): string | undefined {
    // Dedup: skip the first runtime turn_started if we injected the initial prompt.
    // The mapper would otherwise produce a duplicate SessionTurnStarted action.
    if (this.injectedInitialTurn && event.type === "turn_started") {
      this.injectedInitialTurn = false;
      return undefined;
    }
    const idx = this.context.eventIndex++;
    const { actions, note } = mapAgentEvent(event, idx, this.context);

    // Fold each action through the reducer.
    // All actions from the mapper are session-specific, so casting to SessionAction is safe.
    for (const action of actions) {
      this.state = sessionReducer(this.state, action as SessionAction);
      this.actionCountSinceLastFlush += 1;
    }

    // Apply mapper carries (_meta fields the reducer doesn't handle).
    // Only re-create _meta when values actually change (avoids unnecessary
    // object identity updates that break equality checks downstream).
    const metaChanges: Partial<SessionState["_meta"]> = {};
    if (this.context.metaAccumulator.costMillicents !== undefined) {
      const existing = this.state._meta?.costMillicents;
      if (existing === undefined || existing !== this.context.metaAccumulator.costMillicents) {
        metaChanges.costMillicents = this.context.metaAccumulator.costMillicents;
      }
    }
    if (this.context.metaAccumulator.runtimeSessionId !== undefined) {
      const existing = this.state._meta?.runtimeSessionId;
      if (existing === undefined || existing !== this.context.metaAccumulator.runtimeSessionId) {
        metaChanges.runtimeSessionId = this.context.metaAccumulator.runtimeSessionId;
      }
    }
    if (Object.keys(metaChanges).length > 0) {
      this.state._meta = { ...(this.state._meta ?? {}), ...metaChanges };
    }

    let lastSeq: string | undefined;

    // Check snapshot threshold
    if (this.snapshotThreshold > 0 && this.actionCountSinceLastFlush >= this.snapshotThreshold) {
      this.snapshot(serverSeq);
      lastSeq = serverSeq;
    }
    // Auto-snapshot on turn_complete (only if not already flushed above)
    else if (
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- note.type is always defined when note is non-null
      note &&
      note.disposition === "mapped" &&
      note.type === "turn_complete"
    ) {
      this.snapshot(serverSeq);
      lastSeq = serverSeq;
    }

    return lastSeq;
  }

  /**
   * Mark that the initial prompt was injected as turn_started.
   * The next runtime turn_started will be skipped to avoid a duplicate.
   */
  public markInjectedInitialTurn(): void {
    this.injectedInitialTurn = true;
  }

  /**
   * Get the current SessionState.
   *
   * Returns a deep clone frozen to prevent callers from mutating the
   * manager's internal state.
   *
   * @returns A frozen deep clone of the current state.
   */
  public getState(): SessionState {
    const copy = structuredClone(this.state);
    try {
      Object.freeze(copy.turns);
    } catch {
      /* ignore */
    }
    try {
      copy.turns.forEach(Object.freeze);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy.queuedMessages);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy.inputRequests);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy.config);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy._meta);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy);
    } catch {
      /* ignore */
    }
    return copy;
  }

  /**
   * Get the current mapper context (useful for debugging or external state sync).
   *
   * Returns a deep clone frozen to prevent callers from mutating the
   * manager's internal state.
   *
   * @returns A frozen deep clone of the current context.
   */
  public getContext(): MapperContext {
    const copy = structuredClone(this.context);
    try {
      Object.freeze(copy.openToolCalls);
    } catch {
      /* ignore */
    }
    try {
      Object.freeze(copy);
    } catch {
      /* ignore */
    }
    return copy;
  }

  /**
   * Persist a snapshot of the current SessionState and MapperContext to the store.
   *
   * Serializes key fields from SessionState (summary, lifecycle, turns,
   * activeTurn, steeringMessage, queuedMessages, inputRequests, config, _meta)
   * and the full MapperContext into JSON. Excludes serverTools, activeClient,
   * and customizations.
   *
   * @param lastSeq - ULID string of the last action included in this snapshot.
   * @returns Result describing whether a snapshot was persisted.
   */
  public snapshot(lastSeq: string = "0"): SnapshotResult {
    try {
      const snapshotData = this.serializeSnapshot();
      const record: SnapshotRecord = {
        seq: lastSeq,
        sessionId: this.sessionId,
        snapshotAt: new Date().toISOString(),
        state: snapshotData,
        mapperContext: JSON.stringify(this.context),
      };
      this.store.persistSnapshot(record);

      this.actionCountSinceLastFlush = 0;

      logger.info({ sessionId: this.sessionId, seq: lastSeq }, "Snapshot persisted");

      return { persisted: true, lastSeq };
    } catch (err) {
      logger.error({ err, sessionId: this.sessionId }, "Failed to persist snapshot");
      return { persisted: false };
    }
  }

  /**
   * Clear internal state. Call on session shutdown.
   */
  public clear(): void {
    this.state = this.createInitialState();
    this.context = {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      eventIndex: 0,
      metaAccumulator: {},
    };
    this.actionCountSinceLastFlush = 0;
  }

  /**
   * Reconstruct SessionState from the latest snapshot plus delta actions.
   *
   * Strategy:
   * - If the snapshot includes a `mapperContext`: delta replay — replay only the
   *   actions since the snapshot using the stored context (O(delta)).
   * - If the snapshot is missing a `mapperContext` (older snapshot): full replay —
   *   replay all session_actions from the start with a fresh context (O(n) fallback).
   * - If there is no snapshot at all: full replay from the beginning.
   *
   * @param sessionId - The session to reconstruct.
   * @param store - Persistence store to read from. Defaults to the real DB store.
   *   Pass the same store used during `processEvent` when testing.
   * @returns Reconstructed SessionState, or a minimal initial state if no
   *          snapshot or actions exist.
   */
  public static reconstruct(sessionId: string, store?: SessionStore): SessionState {
    const s = store ?? defaultStore;
    const snapshots = s.querySnapshot(sessionId, 1);

    if (snapshots.length === 0) {
      return SessionStateManager.replayAllActions(sessionId, s);
    }

    const latest = snapshots[0];

    let baseState: SessionState;
    try {
      baseState = JSON.parse(latest.state) as SessionState;
    } catch (err) {
      logger.error(
        { err, sessionId, seq: latest.seq },
        "Corrupted snapshot state — falling back to full replay",
      );
      return SessionStateManager.replayAllActions(sessionId, s);
    }

    // Delta replay: use stored MapperContext to seed the replay
    if (latest.mapperContext) {
      let replayContext: MapperContext;
      try {
        const parsed = JSON.parse(latest.mapperContext) as MapperContext;
        // Normalize fields that may be missing from snapshots written before they were added.
        // eventIndex defaults to 0 so synthetic IDs (turn-N, tc-N) start fresh rather than NaN.
        replayContext = {
          ...parsed,
          eventIndex: Number.isFinite(parsed.eventIndex) ? parsed.eventIndex : 0,
          openToolCalls: Array.isArray(parsed.openToolCalls) ? parsed.openToolCalls : [],
          partCounter: Number.isFinite(parsed.partCounter) ? parsed.partCounter : 0,
        };
      } catch (err) {
        logger.warn(
          { err, sessionId, seq: latest.seq },
          "Corrupted snapshot mapperContext — falling back to full replay",
        );
        return SessionStateManager.replayAllActions(sessionId, s);
      }

      const deltaRows = s.querySessionActions({
        sessionId,
        fromSeq: latest.seq,
        limit: MAX_RECONSTRUCTION_EVENTS,
      });

      return SessionStateManager.replayRows(baseState, replayContext, deltaRows);
    }

    // Snapshot exists but has no mapperContext (old snapshot format) — full replay
    logger.debug(
      { sessionId, seq: latest.seq },
      "Snapshot missing mapperContext — falling back to full replay",
    );
    return SessionStateManager.replayAllActions(sessionId, s);
  }

  private createInitialState(): SessionState {
    return SessionStateManager.createInitialState(this.sessionId);
  }

  private static createInitialState(sessionId: string): SessionState {
    return {
      summary: {
        resource: `ahp-session:${sessionId}`,
        provider: "grackle",
        title: "",
        status: SessionStatus.Idle,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      lifecycle: SessionLifecycle.Creating,
      turns: [],
    };
  }

  private static replayAllActions(sessionId: string, store: SessionStore): SessionState {
    const allRows = store.querySessionActions({
      sessionId,
      limit: MAX_RECONSTRUCTION_EVENTS,
    });

    if (allRows.length === 0) {
      return SessionStateManager.createInitialState(sessionId);
    }

    const freshContext: MapperContext = {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      eventIndex: 0,
      metaAccumulator: {},
    };

    return SessionStateManager.replayRows(
      SessionStateManager.createInitialState(allRows[0].sessionId),
      freshContext,
      allRows,
    );
  }

  /**
   * Event types that correspond to rows fed through `SessionStateManager.processEvent()`
   * in the live pipeline. Rows with other types (e.g. `signal`, `widget`) are recorded in
   * `session_actions` by other code paths but were never processed by the state manager,
   * so replaying them would incorrectly advance `context.eventIndex`.
   *
   * "user_input" is intentionally absent — it is handled separately by remapping it to
   * "turn_started" before calling `mapAgentEvent`.
   */
  private static readonly AGENT_EVENT_TYPES: ReadonlySet<string> = new Set([
    "turn_started",
    "turn_complete",
    "input_needed",
    "text",
    "tool_use",
    "tool_result",
    "usage",
    "error",
    "status",
    "system",
    "runtime_session_id",
  ]);

  private static replayRows(
    baseState: SessionState,
    context: MapperContext,
    rows: SessionActionRow[],
  ): SessionState {
    let state = baseState;
    // Mirrors the live pipeline's markInjectedInitialTurn dedup: when a "user_input"
    // row is remapped to "turn_started", the runtime's subsequent real turn_started is
    // skipped (without advancing eventIndex) to avoid a duplicate SessionTurnStarted.
    let skipNextTurnStarted = false;

    for (const row of rows) {
      // "user_input" rows are stored in session_actions for the injected prompt, but
      // the live pipeline processed them as synthetic "turn_started" events via
      // makeAgentEvent(..., "turn_started", JSON.stringify({user_message: content})).
      // Replicate that here to keep eventIndex and state consistent with the live run.
      let eventRow = row;
      if (row.type === "user_input") {
        eventRow = {
          ...row,
          type: "turn_started",
          content: JSON.stringify({ user_message: row.content }),
        };
        skipNextTurnStarted = true;
      } else if (skipNextTurnStarted && row.type === "turn_started") {
        // Skip the runtime's real turn_started (mirrors markInjectedInitialTurn dedup).
        // Do NOT advance eventIndex — the live pipeline skipped this event before the
        // eventIndex increment.
        skipNextTurnStarted = false;
        continue;
      } else if (!SessionStateManager.AGENT_EVENT_TYPES.has(row.type)) {
        // Skip rows recorded by other code paths (signal, widget, etc.) that were
        // never fed through processEvent() in the live pipeline. Do NOT advance
        // eventIndex so it stays aligned with the live run.
        continue;
      }

      const event = SessionStateManager.reconstructAgentEvent(eventRow);
      // Use context.eventIndex so delta replay starts from the correct offset,
      // keeping synthetic turn/tool IDs consistent with the live processing run.
      const { actions } = mapAgentEvent(event, context.eventIndex++, context);

      for (const action of actions) {
        state = sessionReducer(state, action as SessionAction);
      }

      if (context.metaAccumulator.costMillicents !== undefined) {
        state._meta = {
          ...(state._meta ?? {}),
          costMillicents: context.metaAccumulator.costMillicents,
        };
      }
      if (context.metaAccumulator.runtimeSessionId !== undefined) {
        state._meta = {
          ...(state._meta ?? {}),
          runtimeSessionId: context.metaAccumulator.runtimeSessionId,
        };
      }
    }

    return state;
  }

  private static reconstructAgentEvent(row: SessionActionRow): powerline.AgentEvent {
    return create(powerline.AgentEventSchema, {
      sessionId: row.sessionId,
      type: row.type,
      timestamp: row.timestamp,
      content: row.content,
      raw: row.raw,
      toolCallId: row.toolCallId,
      turnId: row.turnId,
      diagnostic: row.diagnostic,
    });
  }

  private serializeSnapshot(): string {
    const {
      summary,
      lifecycle,
      turns,
      activeTurn,
      steeringMessage,
      queuedMessages,
      inputRequests,
      config,
      _meta,
    } = this.state;

    return JSON.stringify({
      summary,
      lifecycle,
      turns,
      activeTurn,
      steeringMessage,
      queuedMessages,
      inputRequests,
      config,
      _meta,
    });
  }
}
