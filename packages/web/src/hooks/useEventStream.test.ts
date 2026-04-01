// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { useEventStream, RECONNECT_DELAY_MS, CONNECT_GRACE_PERIOD_MS } from "./useEventStream.js";

// ---------------------------------------------------------------------------
// Mock grackleClient
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  streamEvents: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
}));

vi.mock("@grackle-ai/web-components", () => ({
  PAIR_PATH: "/pair",
}));

// Re-exported from useEventStream.ts — imported above, referenced below.

// ---------------------------------------------------------------------------
// Helpers: controllable async iterable stream
// ---------------------------------------------------------------------------

interface MockStream {
  /** The async iterable to return from streamEvents(). */
  iterable: AsyncIterable<unknown>;
  /** Emit a value on the stream. */
  emit: (value: unknown) => void;
  /** End the stream (no more values). */
  end: () => void;
  /** Push an error into the stream. */
  error: (err: Error) => void;
}

function createMockStream(): MockStream {
  type Resolver = (result: IteratorResult<unknown>) => void;
  type Rejector = (err: Error) => void;
  const queue: Array<{ resolve: Resolver; reject: Rejector }> = [];
  const pending: Array<IteratorResult<unknown> | Error> = [];

  function push(value: IteratorResult<unknown> | Error): void {
    if (queue.length > 0) {
      const entry = queue.shift()!;
      if (value instanceof Error) {
        entry.reject(value);
      } else {
        entry.resolve(value);
      }
    } else {
      pending.push(value);
    }
  }

  const iterator: AsyncIterator<unknown> = {
    next(): Promise<IteratorResult<unknown>> {
      if (pending.length > 0) {
        const value = pending.shift()!;
        if (value instanceof Error) {
          return Promise.reject(value);
        }
        return Promise.resolve(value);
      }
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject });
      });
    },
    return(): Promise<IteratorResult<unknown>> {
      return Promise.resolve({ done: true, value: undefined });
    },
  };

  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return iterator;
    },
  };

  return {
    iterable,
    emit: (value: unknown) => push({ done: false, value }),
    end: () => push({ done: true, value: undefined }),
    error: (err: Error) => push(err),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useEventStream", () => {
  let stream: MockStream;

  beforeEach(() => {
    // Use real timers so waitFor retries work correctly
    stream = createMockStream();
    mockClient.streamEvents.mockReturnValue(stream.iterable);
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // NOTE: The "initial connectionStatus is connecting" state is set via
  // useState("connecting") and is visible on the first render paint before
  // the effect fires. In jsdom, effects run synchronously inside act(), so
  // by the time renderHook returns, the stream has already connected.
  // This initial state is verified visually in the Storybook "Connecting" story.

  it("connectionStatus is connected after receiving first event", async () => {
    const { result } = renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn() }),
    );

    // Wait for stream to be established
    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    // Emitting an event triggers markConnected immediately
    act(() => {
      stream.emit({
        event: { case: "sessionEvent", value: { sessionId: "", type: 0, timestamp: "", content: "", raw: "" } },
      });
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("connected");
    });
  });

  it("stays connecting when stream errors immediately (server unreachable)", async () => {
    vi.useFakeTimers();
    try {
      const errorStream = createMockStream();
      mockClient.streamEvents.mockReturnValue(errorStream.iterable);

      const { result } = renderHook(() =>
        useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn() }),
      );

      // Flush microtasks so connectStream runs and the for-await begins
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      // Immediately error the stream — simulates ECONNREFUSED
      act(() => {
        errorStream.error(new Error("ECONNREFUSED"));
      });

      // Flush microtasks for the catch block to run (clears the connect timer)
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      // Advance past the grace period — the timer was cancelled, so "connected" must NOT fire
      await act(async () => {
        vi.advanceTimersByTime(CONNECT_GRACE_PERIOD_MS + 10);
      });

      expect(result.current.connectionStatus).toBe("connecting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("connectionStatus transitions to connecting (not disconnected) after stream drops", async () => {
    const { result } = renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn() }),
    );

    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    // Emit an event to mark the stream as "connected"
    act(() => {
      stream.emit({
        event: { case: "sessionEvent", value: { sessionId: "", type: 0, timestamp: "", content: "", raw: "" } },
      });
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("connected");
    });

    act(() => {
      stream.end();
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe("connecting");
    });
  });

  // NOTE: Cleanup on unmount (clearing timers, setting cancelled flag) runs
  // correctly but cannot be observed via result.current — React 18 drops all
  // state updates on unmounted components silently. This hook intentionally
  // does not call setConnectionStatus in cleanup.

  it("calls onConnect callback immediately when stream is created", async () => {
    const onConnect = vi.fn();
    renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn(), onConnect }),
    );

    // onConnect fires as soon as the stream attempt begins (data loading is optimistic)
    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledTimes(1);
    });
  });

  it("calls onDisconnect callback when stream drops", async () => {
    const onDisconnect = vi.fn();
    renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn(), onDisconnect }),
    );

    // Wait until initially connected
    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    act(() => {
      stream.end();
    });

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("reconnects after RECONNECT_DELAY_MS when stream ends", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() =>
        useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn() }),
      );

      // Flush microtasks to let connectStream run and set up the stream
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);

      // Prepare next stream before ending current
      const nextStream = createMockStream();
      mockClient.streamEvents.mockReturnValue(nextStream.iterable);

      // End the current stream
      act(() => {
        stream.end();
      });

      // Flush microtasks for stream end handling
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      // Advance past the reconnect delay
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_DELAY_MS + 10);
      });

      // Flush microtasks for the reconnect attempt
      await act(async () => { await Promise.resolve(); });

      expect(mockClient.streamEvents).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("redirects to pair page on Unauthenticated error", async () => {
    const authStream = createMockStream();
    mockClient.streamEvents.mockReturnValue(authStream.iterable);

    renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent: vi.fn() }),
    );

    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    act(() => {
      authStream.error(new ConnectError("unauthenticated", Code.Unauthenticated));
    });

    await waitFor(() => {
      expect(window.location.href).toBe("/pair");
    });
  });

  it("routes session events to onSessionEvent callback", async () => {
    const onSessionEvent = vi.fn();
    renderHook(() =>
      useEventStream({ onSessionEvent, onDomainEvent: vi.fn() }),
    );

    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    act(() => {
      stream.emit({
        event: {
          case: "sessionEvent",
          value: {
            sessionId: "sess-1",
            type: 1,
            timestamp: "2024-01-01T00:00:00Z",
            content: "hello",
            raw: "",
          },
        },
      });
    });

    await waitFor(() => {
      expect(onSessionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-1", content: "hello" }),
      );
    });
  });

  it("routes domain events to onDomainEvent callback", async () => {
    const onDomainEvent = vi.fn();
    renderHook(() =>
      useEventStream({ onSessionEvent: vi.fn(), onDomainEvent }),
    );

    await waitFor(() => {
      expect(mockClient.streamEvents).toHaveBeenCalledTimes(1);
    });

    act(() => {
      stream.emit({
        event: {
          case: "domainEvent",
          value: {
            id: "evt-1",
            type: "task.created",
            timestamp: "2024-01-01T00:00:00Z",
            payloadJson: "{}",
          },
        },
      });
    });

    await waitFor(() => {
      expect(onDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "evt-1", type: "task.created" }),
      );
    });
  });
});

