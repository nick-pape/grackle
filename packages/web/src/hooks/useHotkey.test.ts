// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useHotkey } from "./useHotkey.js";

/** Dispatch a keyboard event on `document`. */
function pressKey(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useHotkey", () => {
  it("fires callback when the correct key is pressed", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "n" }, cb));

    pressKey("n");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a different key is pressed", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "n" }, cb));

    pressKey("m");
    expect(cb).not.toHaveBeenCalled();
  });

  it("suppresses in input elements by default", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "n" }, cb));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey("n");
    expect(cb).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("fires in input elements when suppressInInputs is false", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "Escape", suppressInInputs: false }, cb));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey("Escape");
    expect(cb).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it("requires ctrl/meta when ctrl option is set", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "/", ctrl: true }, cb));

    pressKey("/");
    expect(cb).not.toHaveBeenCalled();

    pressKey("/", { ctrlKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("requires ctrl/meta — metaKey also works", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "/", ctrl: true }, cb));

    pressKey("/", { metaKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire when enabled is false", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "n", enabled: false }, cb));

    pressKey("n");
    expect(cb).not.toHaveBeenCalled();
  });

  it("cleans up listener on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useHotkey({ key: "n" }, cb));

    unmount();
    pressKey("n");
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not fire when ctrl is pressed but not required", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "n" }, cb));

    pressKey("n", { ctrlKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it("fires for keys that inherently require shift (like '?') without shift option", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "?" }, cb));

    pressKey("?", { shiftKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("requires shift when shift option is true", () => {
    const cb = vi.fn();
    renderHook(() => useHotkey({ key: "A", shift: true }, cb));

    pressKey("A", { shiftKey: false });
    expect(cb).not.toHaveBeenCalled();

    pressKey("A", { shiftKey: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
