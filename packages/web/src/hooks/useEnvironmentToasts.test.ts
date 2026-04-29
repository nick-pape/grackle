// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEnvironmentToasts } from "./useEnvironmentToasts.js";
import type { Environment } from "./useGrackleSocket.js";

// ── Helpers ─────────────────────────────────────────────────

function makeEnv(id: string, status: Environment["status"]): Environment {
  return {
    id,
    displayName: `Env ${id}`,
    adapterType: "codespace",
    status,
    bootstrapped: true,
    defaultRuntime: "claude-code",
    maxConcurrentSessions: 0,
    adapterConfig: "{}",
    githubAccountId: "",
  } as unknown as Environment;
}

// ── Tests ───────────────────────────────────────────────────

describe("useEnvironmentToasts", () => {
  it("does not toast on initial load", () => {
    const showToast = vi.fn();
    renderHook(() => useEnvironmentToasts([makeEnv("e1", "connected")], showToast));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts warning on connected → disconnected (genuine disconnect)", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "connected")] } },
    );
    rerender({ envs: [makeEnv("e1", "disconnected")] });
    expect(showToast).toHaveBeenCalledWith("Environment disconnected", "warning");
  });

  it("does NOT toast on connecting → disconnected (failed auto-reconnect attempt)", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "connecting")] } },
    );
    rerender({ envs: [makeEnv("e1", "disconnected")] });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does NOT toast on disconnected → connecting (auto-reconnect in flight)", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "disconnected")] } },
    );
    rerender({ envs: [makeEnv("e1", "connecting")] });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("produces exactly one warning toast over a full retry cycle (connected→disconnected→connecting→disconnected)", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "connected")] } },
    );

    rerender({ envs: [makeEnv("e1", "disconnected")] }); // genuine disconnect
    rerender({ envs: [makeEnv("e1", "connecting")] });    // auto-reconnect start
    rerender({ envs: [makeEnv("e1", "disconnected")] }); // retry failed

    const warningCalls = showToast.mock.calls.filter(([, variant]) => variant === "warning");
    expect(warningCalls).toHaveLength(1);
    expect(warningCalls[0][0]).toBe("Environment disconnected");
  });

  it("toasts success on → connected (recovered)", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "disconnected")] } },
    );
    rerender({ envs: [makeEnv("e1", "connected")] });
    expect(showToast).toHaveBeenCalledWith("Environment connected", "success");
  });

  it("toasts error on → error", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "disconnected")] } },
    );
    rerender({ envs: [makeEnv("e1", "error")] });
    expect(showToast).toHaveBeenCalledWith("Environment provision failed", "error");
  });

  it("does not toast on → sleeping", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "disconnected")] } },
    );
    rerender({ envs: [makeEnv("e1", "sleeping")] });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts info on environment removed", () => {
    const showToast = vi.fn();
    const { rerender } = renderHook(
      ({ envs }) => useEnvironmentToasts(envs, showToast),
      { initialProps: { envs: [makeEnv("e1", "connected")] } },
    );
    rerender({ envs: [] });
    expect(showToast).toHaveBeenCalledWith("Environment removed", "info");
  });
});
