/**
 * Broker-injected session events — widget renders and document-show notifications.
 *
 * These are standalone push functions called by the MCP server when an agent
 * invokes a widget tool or `show_file`. Extracted from {@link ./event-processor.ts}
 * because they are self-contained, have no dependency on the event-processing loop,
 * and are wired separately into the MCP server.
 */
import { create } from "@bufbuild/protobuf";
import { grackle, serverTimestamp } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import { recordSessionAction } from "./session-action-recorder.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";

/** Payload for an MCP Apps widget render event pushed into a session stream. */
export interface WidgetEventPayload {
  /** The `ui://` resource the widget renders (may be empty for one-off renders). */
  resourceUri: string;
  /** Name of the tool that produced the widget. */
  toolName: string;
  /** Widget HTML (`text/html;profile=mcp-app`). */
  html: string;
  /**
   * Renderer the frontend should dispatch to. `"mcp-app-html"` (default when
   * omitted) renders `html` in the sandbox; future kinds (e.g. declarative) add
   * cases without changing this contract.
   */
  rendererKind?: string;
  /** CSP for the sandbox (`resourceDomains`/`connectDomains` + `allowInlineScripts`). */
  csp?: unknown;
  /** Tool input arguments / render-time props. */
  toolInput?: Record<string, unknown>;
  /** Tool result (an MCP `CallToolResult`). */
  toolResult?: unknown;
  /** Registry id when rendering a registered widget (#1239). */
  widgetId?: string;
  /** Registry version, when known. */
  version?: number;
  /**
   * Resolved registry components this render composes from, in eval order
   * (deepest first). The grackle-react runtime evaluates each into scope before
   * the main body so it can reference them as JSX tags (#1270 composition).
   */
  components?: Array<{ name: string; body: string }>;
}

/** Callback that pushes a widget event into a session's stream (injected into the MCP server). */
export type PublishWidgetEvent = (sessionId: string, payload: WidgetEventPayload) => void;

/**
 * Publish an MCP Apps widget render event into a session's event stream.
 *
 * Called by Grackle's MCP server (the broker) when an agent invokes a widget
 * tool. The event is self-contained (resource HTML + tool input/result) so the
 * web chat renders it without contacting the MCP server. Persisted to the
 * session log (replays on reload) and broadcast live. Non-fatal on error.
 */
export function publishWidgetEvent(sessionId: string, payload: WidgetEventPayload): void {
  const { sessionStore } = getDatabaseStores();
  try {
    const event = create(grackle.SessionEventSchema, {
      sessionId,
      type: grackle.EventType.WIDGET,
      timestamp: serverTimestamp(),
      content: JSON.stringify(payload),
      raw: JSON.stringify({ widget: true, toolName: payload.toolName }),
    });
    event.serverSeq = recordSessionAction(event) ?? "";
    const session = sessionStore.getSession(sessionId);
    if (session?.logPath) {
      logWriter.ensureLogInitialized(session.logPath);
      logWriter.writeEvent(session.logPath, event).catch((err: unknown) => {
        logger.error({ err, sessionId }, "Failed to persist widget event");
      });
    }
    streamHub.publish(event);
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to publish widget event");
  }
}

/** Payload for a `document.show` domain event (live docs v0, #1396). */
export interface DocumentShowPayload {
  /** The `file://` resource URI the UI should open a read-only live view of. */
  uri: string;
}

/**
 * Callback that emits a `document.show` domain event for a session (injected
 * into the MCP server, mirroring {@link PublishWidgetEvent}).
 */
export type PublishDocumentShow = (sessionId: string, payload: DocumentShowPayload) => void;

/**
 * Emit a `document.show` domain event so the web `useDocuments` hook opens a
 * read-only live view of a file (#1396 live docs v0).
 *
 * Called by Grackle's MCP server (the broker) when an agent invokes `show_file`.
 * Unlike the widget broker — which bakes HTML into a persisted session event —
 * this carries only the URI **reference** and rides the domain-event bus (like
 * `resource.changed`), so the doc stays live for multiple viewers and the tab is
 * client UI state rather than chat-stream content. The `environmentId` is
 * resolved from the session here (so the caller only supplies the URI).
 * Non-fatal on error / unknown session.
 */
export function publishDocumentShow(sessionId: string, payload: DocumentShowPayload): void {
  const { sessionStore } = getDatabaseStores();
  try {
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      logger.warn({ sessionId }, "Cannot publish document.show: unknown session");
      return;
    }
    emit("document.show", {
      environmentId: session.environmentId,
      uri: payload.uri,
      sessionId,
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to publish document.show event");
  }
}
