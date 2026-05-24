/**
 * StreamTranscript — read-only transcript of an IPC stream room (RFC #1264 Phase 2).
 *
 * Pure presentational: renders an ordered (oldest-first) list of stream messages
 * with sender + timestamp. Fed by the durable transcript (scrollback) merged with
 * the live message feed; the owning page supplies the data and loading state.
 *
 * @module
 */

import { type JSX } from "react";
import type { StreamMessageData } from "../../hooks/types.js";
import styles from "./StreamTranscript.module.scss";

/** Props for the StreamTranscript component. */
export interface StreamTranscriptProps {
  /** Messages to render, oldest first. */
  messages: StreamMessageData[];
  /** Whether the transcript is currently loading (scrollback fetch in flight). */
  loading?: boolean;
}

/** Format an ISO 8601 timestamp as a short local time. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

/** Read-only, ordered transcript of an IPC stream room's messages. */
export function StreamTranscript({ messages, loading = false }: StreamTranscriptProps): JSX.Element {
  if (loading) {
    return (
      <div className={styles.state} data-testid="stream-transcript-loading">
        Loading transcript…
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className={styles.state} data-testid="stream-transcript-empty">
        No messages yet.
      </div>
    );
  }
  return (
    <div className={styles.transcript} data-testid="stream-transcript">
      {messages.map((m) => (
        <div key={m.seq} className={styles.message} data-testid="stream-transcript-message">
          <div className={styles.meta}>
            <span className={styles.sender} title={m.senderId}>{m.senderId.slice(0, 12)}</span>
            <span className={styles.time}>{formatTime(m.timestamp)}</span>
          </div>
          <div className={styles.content}>{m.content}</div>
        </div>
      ))}
    </div>
  );
}
