// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoadingState } from "./useLoadingState.js";

/** Create a deferred promise whose resolve/reject can be called externally. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

describe("useLoadingState", () => {
  it("loading starts false", () => {
    const { result } = renderHook(() => useLoadingState());
    expect(result.current.loading).toBe(false);
  });

  it("loading flips true on track(), false when promise resolves", async () => {
    const { result } = renderHook(() => useLoadingState());
    const d = deferred<string>();

    act(() => { result.current.track(d.promise).catch(() => {}); });
    expect(result.current.loading).toBe(true);

    act(() => { d.resolve("done"); });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("loading flips false when promise rejects", async () => {
    const { result } = renderHook(() => useLoadingState());
    const d = deferred<string>();

    act(() => { result.current.track(d.promise).catch(() => {}); });
    expect(result.current.loading).toBe(true);

    act(() => { d.reject(new Error("fail")); });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("stays true until ALL concurrent tracked promises settle", async () => {
    const { result } = renderHook(() => useLoadingState());
    const d1 = deferred<string>();
    const d2 = deferred<string>();

    act(() => {
      result.current.track(d1.promise).catch(() => {});
      result.current.track(d2.promise).catch(() => {});
    });
    expect(result.current.loading).toBe(true);

    // Resolve first — should STILL be loading (second is in-flight)
    act(() => { d1.resolve("first"); });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // Resolve second — now loading should be false
    act(() => { d2.resolve("second"); });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
