/**
 * Static mock IPC streams for the Coordination surface in `?mock` demo mode.
 *
 * Subscribers reference sessions from {@link MOCK_SESSIONS}; sessions carry a
 * `taskId`, so the Coordination tab attributes each stream to its owning task.
 * Internal plumbing (`lifecycle:`/`pipe:`/`stdin:`) is hidden until the user
 * toggles "Show internals".
 *
 * @module
 */

import type { StreamData, StreamMessageData } from "../hooks/types.js";

/** Sample IPC streams: a chatroom + channel attributed to tasks, an unattached
 * stream, and internal plumbing streams. */
export const MOCK_STREAMS: StreamData[] = [
  {
    id: "stream-planning",
    name: "jwt-planning-room",
    selfEcho: true,
    subscriberCount: 2,
    messageBufferDepth: 3,
    subscribers: [
      {
        subscriptionId: "sub-p1",
        sessionId: "sess-001",
        fd: 3,
        permission: "rw",
        deliveryMode: "async",
        createdBySpawn: false,
      },
      {
        subscriptionId: "sub-p2",
        sessionId: "sess-002",
        fd: 4,
        permission: "r",
        deliveryMode: "async",
        createdBySpawn: true,
      },
    ],
  },
  {
    id: "stream-metrics",
    name: "rate-limit-metrics",
    selfEcho: false,
    subscriberCount: 1,
    messageBufferDepth: 0,
    subscribers: [
      {
        subscriptionId: "sub-m1",
        sessionId: "sess-004",
        fd: 3,
        permission: "r",
        deliveryMode: "sync",
        createdBySpawn: false,
      },
    ],
  },
  {
    id: "stream-cli",
    name: "cli-inspector",
    selfEcho: false,
    subscriberCount: 1,
    messageBufferDepth: 1,
    subscribers: [
      {
        subscriptionId: "sub-c1",
        sessionId: "external-cli-session",
        fd: 5,
        permission: "rw",
        deliveryMode: "async",
        createdBySpawn: false,
      },
    ],
  },
  // ── Internal plumbing — hidden unless "Show internals" is on ──
  {
    id: "stream-lifecycle",
    name: "lifecycle:sess-001-7f3a",
    selfEcho: false,
    subscriberCount: 1,
    messageBufferDepth: 0,
    subscribers: [
      {
        subscriptionId: "sub-l1",
        sessionId: "sess-001",
        fd: 6,
        permission: "rw",
        deliveryMode: "detach",
        createdBySpawn: true,
      },
    ],
  },
  {
    id: "stream-pipe",
    name: "pipe:sess-001-sess-004",
    selfEcho: false,
    subscriberCount: 2,
    messageBufferDepth: 0,
    subscribers: [
      {
        subscriptionId: "sub-pp1",
        sessionId: "sess-001",
        fd: 7,
        permission: "rw",
        deliveryMode: "async",
        createdBySpawn: false,
      },
      {
        subscriptionId: "sub-pp2",
        sessionId: "sess-004",
        fd: 8,
        permission: "rw",
        deliveryMode: "async",
        createdBySpawn: true,
      },
    ],
  },
  {
    id: "stream-stdin",
    name: "stdin:sess-002-9c2e",
    selfEcho: false,
    subscriberCount: 1,
    messageBufferDepth: 0,
    subscribers: [
      {
        subscriptionId: "sub-s1",
        sessionId: "sess-002",
        fd: 9,
        permission: "w",
        deliveryMode: "detach",
        createdBySpawn: true,
      },
    ],
  },
];

/** Sample transcript messages for the planning room, keyed by stream id (RFC #1264 Phase 2). */
export const MOCK_STREAM_MESSAGES: Record<string, StreamMessageData[]> = {
  "stream-planning": [
    {
      streamId: "stream-planning",
      seq: "01J0000000000000000000MSG1",
      senderId: "sess-001",
      content: "Proposing JWT with RS256 + 15-min access tokens.",
      timestamp: "2026-05-24T18:00:01.000Z",
    },
    {
      streamId: "stream-planning",
      seq: "01J0000000000000000000MSG2",
      senderId: "sess-002",
      content: "Agreed. Refresh tokens rotate on use; store the jti denylist in Redis.",
      timestamp: "2026-05-24T18:00:07.000Z",
    },
    {
      streamId: "stream-planning",
      seq: "01J0000000000000000000MSG3",
      senderId: "sess-001",
      content: "Ship it. I'll wire the middleware; you take the refresh endpoint.",
      timestamp: "2026-05-24T18:00:14.000Z",
    },
  ],
};
