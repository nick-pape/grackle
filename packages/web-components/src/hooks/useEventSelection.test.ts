// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEventSelection } from "./useEventSelection.js";
import type { DisplayEvent } from "../utils/sessionEvents.js";

/** Build a minimal DisplayEvent. */
function makeEvent(eventType: string, content: string = ""): DisplayEvent {
  return {
    sessionId: "sess-1",
    eventType,
    timestamp: "2026-01-15T14:34:00Z",
    content,
  };
}

/** Sample events: 5 content-bearing + 1 status (non-content). */
const SAMPLE_EVENTS: DisplayEvent[] = [
  makeEvent("user_input", "Hello"),          // 0
  makeEvent("text", "Response 1"),            // 1
  makeEvent("status", "running"),             // 2 (non-content)
  makeEvent("tool_result", "file contents"),  // 3
  makeEvent("text", "Response 2"),            // 4
  makeEvent("error", "Something broke"),      // 5
];

const mockFormat = vi.fn((events: DisplayEvent[]) =>
  events.map((e) => e.content).join("\n"),
);

function renderSelection(events: DisplayEvent[] = SAMPLE_EVENTS): ReturnType<typeof renderHook<ReturnType<typeof useEventSelection>, unknown>> {
  return renderHook(() =>
    useEventSelection({ events, formatForClipboard: mockFormat }),
  );
}

describe("useEventSelection", () => {
  beforeEach(() => {
    mockFormat.mockClear();
  });

  it("starts in non-selecting mode with empty selection", () => {
    const { result } = renderSelection();
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectedIndices.size).toBe(0);
  });

  it("enters selection mode with an initial index", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(1); });
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.selectedIndices.has(1)).toBe(true);
  });

  it("enters selection mode without an initial index", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(); });
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.selectedCount).toBe(0);
  });

  it("cancels selection mode and clears selection", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(0); });
    act(() => { result.current.toggleEvent(1); });
    expect(result.current.selectedCount).toBe(2);

    act(() => { result.current.cancelSelection(); });
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("toggles individual events on and off", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(0); });

    // Toggle on index 3
    act(() => { result.current.toggleEvent(3); });
    expect(result.current.selectedIndices.has(0)).toBe(true);
    expect(result.current.selectedIndices.has(3)).toBe(true);
    expect(result.current.selectedCount).toBe(2);

    // Toggle off index 0
    act(() => { result.current.toggleEvent(0); });
    expect(result.current.selectedIndices.has(0)).toBe(false);
    expect(result.current.selectedCount).toBe(1);
  });

  it("shift-click selects a range of content-bearing events", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(0); });

    // Shift-click index 4 should select 0, 1, 3, 4 (skip 2 which is status)
    act(() => { result.current.toggleEvent(4, true); });
    expect(result.current.selectedIndices.has(0)).toBe(true);
    expect(result.current.selectedIndices.has(1)).toBe(true);
    expect(result.current.selectedIndices.has(2)).toBe(false); // status event skipped
    expect(result.current.selectedIndices.has(3)).toBe(true);
    expect(result.current.selectedIndices.has(4)).toBe(true);
    expect(result.current.selectedCount).toBe(4);
  });

  it("shift-click works in reverse direction", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(4); });

    // Shift-click index 1 should select 1, 3, 4 (skip 2)
    act(() => { result.current.toggleEvent(1, true); });
    expect(result.current.selectedIndices.has(1)).toBe(true);
    expect(result.current.selectedIndices.has(2)).toBe(false);
    expect(result.current.selectedIndices.has(3)).toBe(true);
    expect(result.current.selectedIndices.has(4)).toBe(true);
  });

  it("selectAll selects only content-bearing events", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(); });
    act(() => { result.current.selectAll(); });

    // Indices 0, 1, 3, 4, 5 are content-bearing; 2 is status
    expect(result.current.selectedCount).toBe(5);
    expect(result.current.selectedIndices.has(0)).toBe(true);
    expect(result.current.selectedIndices.has(1)).toBe(true);
    expect(result.current.selectedIndices.has(2)).toBe(false);
    expect(result.current.selectedIndices.has(3)).toBe(true);
    expect(result.current.selectedIndices.has(4)).toBe(true);
    expect(result.current.selectedIndices.has(5)).toBe(true);
  });

  it("deselectAll clears selection but stays in selection mode", () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(0); });
    act(() => { result.current.toggleEvent(1); });
    expect(result.current.selectedCount).toBe(2);

    act(() => { result.current.deselectAll(); });
    expect(result.current.isSelecting).toBe(true);
    expect(result.current.selectedCount).toBe(0);
  });

  it("copySelected calls formatForClipboard with selected events in order", async () => {
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(4); });
    act(() => { result.current.toggleEvent(0); });

    let success = false;
    await act(async () => {
      success = await result.current.copySelected();
    });

    expect(success).toBe(true);
    expect(mockFormat).toHaveBeenCalledTimes(1);
    // Events should be in index order (0 before 4), not selection order
    const calledWith = mockFormat.mock.calls[0][0] as DisplayEvent[];
    expect(calledWith[0].content).toBe("Hello");       // index 0
    expect(calledWith[1].content).toBe("Response 2");   // index 4
  });

  it("copySelected returns false when clipboard fails", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(0); });

    let success = true;
    await act(async () => {
      success = await result.current.copySelected();
    });
    expect(success).toBe(false);
  });

  it("copySelected returns false when nothing is selected", async () => {
    const { result } = renderSelection();
    act(() => { result.current.enterSelectionMode(); });

    let success = true;
    await act(async () => {
      success = await result.current.copySelected();
    });
    expect(success).toBe(false);
    expect(mockFormat).not.toHaveBeenCalled();
  });
});
