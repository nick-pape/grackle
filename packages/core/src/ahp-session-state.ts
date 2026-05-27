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

import { logger } from "./logger.js";
import type { powerline } from "@grackle-ai/common";
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
  type SnapshotRecord,
} from "@grackle-ai/database";
import { querySessionActions } from "@grackle-ai/database";

/** Default flush interval (actions between snapshots). */
const DEFAULT_SNAPSHOT_THRESHOLD: number = 100;

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
      this.state._meta = { ...this.state._meta ?? {}, ...metaChanges };
    }

    let lastSeq: string | undefined;

   // Check snapshot threshold
   if (
     this.snapshotThreshold > 0 &&
     this.actionCountSinceLastFlush >= this.snapshotThreshold
   ) {
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
    try { Object.freeze(copy.turns); } catch { /* ignore */ }
    try { copy.turns.forEach(Object.freeze); } catch { /* ignore */ }
    try { Object.freeze(copy.queuedMessages); } catch { /* ignore */ }
    try { Object.freeze(copy.inputRequests); } catch { /* ignore */ }
    try { Object.freeze(copy.config); } catch { /* ignore */ }
    try { Object.freeze(copy._meta); } catch { /* ignore */ }
    try { Object.freeze(copy); } catch { /* ignore */ }
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
    try { Object.freeze(copy.openToolCalls); } catch { /* ignore */ }
    try { Object.freeze(copy); } catch { /* ignore */ }
    return copy;
  }

  /**
    * Persist a snapshot of the current SessionState to the database.
    *
    * Serializes key fields from SessionState (summary, lifecycle, turns,
    * activeTurn, steeringMessage, queuedMessages, inputRequests, config, _meta)
    * into JSON. Excludes serverTools, activeClient, and customizations.
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
      };
      persistSnapshot(record);

      this.actionCountSinceLastFlush = 0;

      logger.info(
        { sessionId: this.sessionId, seq: lastSeq },
        "Snapshot persisted",
      );

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
    * Loads the most recent snapshot for the session, then replays all
    * actions from that snapshot's seq onward through the reducer.
    *
    * **Limitation**: Delta replay currently returns `undefined` for each
    * action because session_actions store raw AgentEvents, not AHP actions.
    * The snapshot alone provides a valid baseline; delta replay is reserved
    * for a future implementation that stores AHP action JSON directly.
    *
    * @param sessionId - The session to reconstruct.
    * @returns Reconstructed SessionState, or a minimal initial state if no
    *          snapshot or actions exist.
  */
   public static reconstruct(sessionId: string): SessionState {
    // Load latest snapshot
    const snapshots = querySnapshot(sessionId, 1);
    if (snapshots.length === 0) {
      // No snapshot — return initial state
      return SessionStateManager.createInitialState(sessionId);
    }

const latest = snapshots[0];
     let initialState: SessionState;
     try {
       initialState = JSON.parse(latest.state) as SessionState;
     } catch (err) {
        logger.error({ err, sessionId, seq: latest.seq }, "Corrupted snapshot data — returning initial state");
        return SessionStateManager.createInitialState(sessionId);
      }

    // Replay delta actions from the snapshot seq onward.
    // Currently parseSessionActionToAhpAction returns undefined for each
    // delta (session_actions store raw AgentEvents, not AHP actions).
    // The snapshot baseline is still valid; delta replay is future work.
    const deltaActions = querySessionActions({
      sessionId,
      fromSeq: latest.seq,
      limit: 10000,
    });

    let state = initialState;
    for (const deltaAction of deltaActions) {
      try {
        const action = parseSessionActionToAhpAction(deltaAction);
        if (action) {
          state = sessionReducer(state, action);
        }
      } catch {
        // Non-critical: skip actions that can't be parsed
      }
    }

    return state;
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

/**
  * Parse a session_action row back into an AHP SessionAction for replay.
  *
  * Session actions store event types as strings (e.g. "text", "tool_use")
  * and content as JSON. This function reconstructs the corresponding
  * AHP action from those stored fields.
  *
  * **Current limitation**: session_actions store raw AgentEvents, not AHP
  * actions. Direct reconstruction is not possible without going through
  * the mapper again. This function returns `undefined` pending a future
  * implementation that stores AHP action JSON in session_actions.
  */
 function parseSessionActionToAhpAction(
   _deltaAction: {
     type: string;
     content: string;
     raw: string;
     timestamp: string;
   },
 ): SessionAction | undefined {
   // session_actions store raw AgentEvent data, not AHP actions.
   // Direct reconstruction requires re-running the mapper.
   // Future: store AHP action JSON directly in session_actions.
   return undefined;
 }
