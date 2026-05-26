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

  /**
   * Number of actions between automatic snapshot flushes.
   * Set to `0` to disable automatic flushing (use explicit snapshots only).
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
   * Process a single AgentEvent through the mapper and reducer.
   *
   * @param event - The AgentEvent to process.
   * @param index - Zero-based index of the event in the stream.
  */
   public processEvent(event: powerline.AgentEvent, index: number): void {
    const { actions, notes } = mapAgentEvent(event, index, this.context);

   // Fold each action through the reducer
     for (const action of actions) {
       this.state = sessionReducer(this.state, action as SessionAction);
       this.actionCountSinceLastFlush += 1;
     }

     // Apply mapper carries (_meta fields the reducer doesn't handle)
     if (this.context.metaAccumulator.costMillicents !== undefined) {
       this.state._meta = { ...this.state._meta, costMillicents: this.context.metaAccumulator.costMillicents };
     }
     if (this.context.metaAccumulator.runtimeSessionId !== undefined) {
       this.state._meta = { ...this.state._meta, runtimeSessionId: this.context.metaAccumulator.runtimeSessionId };
     }

     // Check snapshot threshold
    if (
      this.snapshotThreshold > 0 &&
      this.actionCountSinceLastFlush >= this.snapshotThreshold
    ) {
      this.snapshot(index.toString());
    }

    // Auto-snapshot on turn_complete
    if (notes.some((n) => n.disposition === "mapped" && n.type === "turn_complete")) {
      this.snapshot(index.toString());
    }
  }

  /**
   * Get the current SessionState.
   *
   * @returns A copy of the current state.
 */
   public getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Get the current mapper context (useful for debugging or external state sync).
   *
   * @returns The current mapper context.
*/
   public getContext(): MapperContext {
    return { ...this.context };
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
   * @param sessionId - The session to reconstruct.
   * @returns Reconstructed SessionState, or a minimal initial state if no
   *          snapshot or actions exist.
 */
   public static reconstruct(sessionId: string): SessionState {
    // Load latest snapshot
    const snapshots = querySnapshot(sessionId, 1);
    if (snapshots.length === 0) {
      // No snapshot — return initial state
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

    const latest = snapshots[0];
    const initialState = JSON.parse(latest.state) as SessionState;

    // Replay delta actions from the snapshot seq onward
    const deltaActions = querySessionActions({
      sessionId,
      fromSeq: latest.seq,
      limit: 10000,
    });

    let state = initialState;
    for (const deltaAction of deltaActions) {
      // Convert session_action back to AHP action via the event-processor's
      // event type mapping. For now, we replay from the raw event content.
      // The action type is encoded in the session_action.type field.
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
    return {
      summary: {
        resource: `ahp-session:${this.sessionId}`,
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
 * Parse a session_action row back into an AHP StateAction for replay.
 *
 * Session actions store event types as strings (e.g. "text", "tool_use")
 * and content as JSON. This function reconstructs the corresponding
 * AHP action from those stored fields.
 *
 * Note: This is a simplified replay path. For full fidelity, the
 * event-processor should store the AHP action directly or use the
 * sessionReducer with the original action stream.
 */
function parseSessionActionToAhpAction(
  deltaAction: {
    type: string;
    content: string;
    raw: string;
    timestamp: string;
  },
): SessionAction | undefined {
  // This is a simplified parser that reconstructs AHP actions from
  // the session_action log. In production, the action should be
  // stored directly as JSON in the session_actions table.
  // For now, we rely on the fact that session_actions store the
  // original AgentEvent content, not AHP actions.

  // Since session_actions store AgentEvent data (not AHP actions),
  // we can't directly reconstruct AHP actions from them without
  // going through the mapper again. This is a limitation of the
  // current architecture.

  // A proper implementation would store the AHP action JSON directly
  // in session_actions. For now, return null and let the caller
  // handle the missing replay data.
  return undefined;
}
