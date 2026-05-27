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
  persistSnapshot,
  querySnapshot,
  querySessionActions,
  type SessionActionRow,
  type SnapshotRecord,
} from "@grackle-ai/database";

/** Default flush interval (actions between snapshots). */
const DEFAULT_SNAPSHOT_THRESHOLD: number = 100;

/** Hard cap on events replayed during reconstruction (guards against unbounded replay). */
const MAX_RECONSTRUCTION_EVENTS: number = 10_000;

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

  /** Event index for the mapper — ensures turn IDs are unique per turn_started event. */
  private eventIndex: number;

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
   * @param initialSnapshot - Optional initial SessionState from reconstruction.
   */
  public constructor(sessionId: string, initialSnapshot?: SessionState) {
    this.sessionId = sessionId;
    this.actionCountSinceLastFlush = 0;
    this.eventIndex = 0;
    this.snapshotThreshold = DEFAULT_SNAPSHOT_THRESHOLD;
    this.injectedInitialTurn = false;
    this.context = {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      metaAccumulator: {},
    };

    // Start with a minimal SessionState if no snapshot was provided
    if (initialSnapshot) {
      this.state = initialSnapshot;
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
      // Emit a note so the action is recorded but the reducer is skipped.
      return undefined;
    }
    const idx = this.eventIndex++;
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
    // Freeze everything to prevent mutation of internal state.
    // structuredClone already deep-copies turns, activeTurn, etc.
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
   * Persist a snapshot of the current SessionState and MapperContext to the database.
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
      persistSnapshot(record);

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
   * @returns Reconstructed SessionState, or a minimal initial state if no
   *          snapshot or actions exist.
   */
  public static reconstruct(sessionId: string): SessionState {
    const snapshots = querySnapshot(sessionId, 1);

    if (snapshots.length === 0) {
      // No snapshot — full replay from start
      return SessionStateManager.replayAllActions(sessionId);
    }

    const latest = snapshots[0];

    // Parse snapshot state
    let baseState: SessionState;
    try {
      baseState = JSON.parse(latest.state) as SessionState;
    } catch (err) {
      logger.error(
        { err, sessionId, seq: latest.seq },
        "Corrupted snapshot state — falling back to full replay",
      );
      return SessionStateManager.replayAllActions(sessionId);
    }

    // Delta replay: use stored MapperContext to seed the replay
    if (latest.mapperContext) {
      let replayContext: MapperContext;
      try {
        replayContext = JSON.parse(latest.mapperContext) as MapperContext;
      } catch (err) {
        logger.warn(
          { err, sessionId, seq: latest.seq },
          "Corrupted snapshot mapperContext — falling back to full replay",
        );
        return SessionStateManager.replayAllActions(sessionId);
      }

      const deltaRows = querySessionActions({
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
    return SessionStateManager.replayAllActions(sessionId);
  }

  /**
   * Create a minimal initial SessionState.
   */
  private createInitialState(): SessionState {
    return SessionStateManager.createInitialState(this.sessionId);
  }

  /**
   * Create a minimal initial SessionState (static helper for use in
   * `reconstruct()` and `createInitialState()`).
   * @param sessionId - The session ID for the resource field.
   * @returns A fresh initial SessionState.
   */
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

  /**
   * Full replay: fetch all session_actions and replay from initial state with a fresh context.
   * Used when no snapshot is available or the snapshot's mapperContext is missing/corrupt.
   */
  private static replayAllActions(sessionId: string): SessionState {
    const allRows = querySessionActions({
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
      metaAccumulator: {},
    };

    return SessionStateManager.replayRows(
      SessionStateManager.createInitialState(allRows[0].sessionId),
      freshContext,
      allRows,
    );
  }

  /**
   * Replay a sequence of session_action rows through the mapper and reducer,
   * starting from `baseState` with `context`.
   *
   * @param baseState - The SessionState to start from (snapshot or initial).
   * @param context - MapperContext to use for replay (mutated in place).
   * @param rows - Session action rows to replay, oldest first.
   * @returns The reconstructed SessionState after replaying all rows.
   */
  private static replayRows(
    baseState: SessionState,
    context: MapperContext,
    rows: SessionActionRow[],
  ): SessionState {
    let state = baseState;
    let replayIdx = 0;

    for (const row of rows) {
      const event = SessionStateManager.reconstructAgentEvent(row);
      const { actions } = mapAgentEvent(event, replayIdx++, context);

      for (const action of actions) {
        state = sessionReducer(state, action as SessionAction);
      }

      // Apply meta carries (mirrors processEvent logic)
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

  /**
   * Reconstruct a PowerLine AgentEvent from a session_action row.
   *
   * `user_input` rows (injected prompt events) are preserved as-is; the mapper
   * has no `user_input` case and drops them, which is correct — it avoids a
   * duplicate `SessionTurnStarted` alongside the runtime's own `turn_started`.
   */
  private static reconstructAgentEvent(row: SessionActionRow): powerline.AgentEvent {
    return create(powerline.AgentEventSchema, {
      sessionId: row.sessionId,
      type: row.type,
      timestamp: row.timestamp,
      content: row.content,
      raw: row.raw,
      toolCallId: row.toolCallId,
      turnId: row.turnId,
      diagnostic: false,
    });
  }

  /**
   * Serialize key fields of SessionState for snapshot storage.
   *
   * Excludes: serverTools, activeClient, customizations (these are
   * reconstructed from actions on replay).
   */
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
