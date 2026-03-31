// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useManifest, ManifestProvider } from "../context/ManifestContext.js";

/** Wrapper that provides ManifestProvider for renderHook. */
const wrapper = ManifestProvider;

describe("useManifest", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("starts in loading state with fail-open plugin names", () => {
    global.fetch = vi.fn(() => new Promise(() => { /* never resolves */ })) as typeof fetch;

    const { result } = renderHook(() => useManifest(), { wrapper });

    expect(result.current.loading).toBe(true);
    // Fail-open: all known plugins active during loading so domain hooks are not starved
    expect(result.current.pluginNames).toEqual(["core", "orchestration"]);
  });

  it("returns pluginNames from a successful manifest fetch", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ plugins: [{ name: "core" }, { name: "orchestration" }] }),
      } as Response),
    );

    const { result } = renderHook(() => useManifest(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pluginNames).toEqual(["core", "orchestration"]);
    expect(result.current.error).toBeUndefined();
  });

  it("falls back to all known plugins when fetch throws", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network error"))) as typeof fetch;

    const { result } = renderHook(() => useManifest(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pluginNames).toEqual(["core", "orchestration"]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("falls back to all known plugins when response is not ok", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as Response),
    );

    const { result } = renderHook(() => useManifest(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pluginNames).toEqual(["core", "orchestration"]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("falls back when json parsing fails", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error("invalid json")),
      } as Response),
    );

    const { result } = renderHook(() => useManifest(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pluginNames).toEqual(["core", "orchestration"]);
  });
});
