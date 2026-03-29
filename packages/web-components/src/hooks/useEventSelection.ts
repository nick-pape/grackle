/**
 * Selection state management for the multi-select feature in EventStream.
 *
 * Manages entering/exiting selection mode, toggling individual events,
 * shift-click range selection, select all, and clipboard copy.
 *
 * @module
 */

import { useState, useRef, useCallback, useMemo } from "react";
import type { DisplayEvent } from "../utils/sessionEvents.js";
import { isContentBearingEvent } from "../utils/eventContent.js";

/** Options for the useEventSelection hook. */
export interface UseEventSelectionOptions {
  /** All events currently in the stream. */
  events: DisplayEvent[];
  /** Formats events as text for the clipboard. */
  formatForClipboard: (events: DisplayEvent[]) => string;
}

/** Return value of the useEventSelection hook. */
export interface UseEventSelectionReturn {
  /** Whether selection mode is active. */
  isSelecting: boolean;
  /** Set of selected event indices (from the events array). */
  selectedIndices: ReadonlySet<number>;
  /** Number of selected events. */
  selectedCount: number;
  /** Enter selection mode, optionally selecting an initial event. */
  enterSelectionMode: (initialIndex?: number) => void;
  /** Exit selection mode and clear all selections. */
  cancelSelection: () => void;
  /** Toggle an event at the given index. When shiftKey is true, selects the range from the last-toggled anchor. */
  toggleEvent: (index: number, shiftKey?: boolean) => void;
  /** Select all content-bearing events. */
  selectAll: () => void;
  /** Deselect all events but stay in selection mode. */
  deselectAll: () => void;
  /** Copy selected events to clipboard. Returns true on success. */
  copySelected: () => Promise<boolean>;
}

/**
 * Hook that manages event selection state for the EventStream multi-select feature.
 *
 * The caller is responsible for rendering checkboxes, highlights, and action bars
 * based on the returned state. The `copySelected` method uses `navigator.clipboard`
 * and will return `false` in environments where the Clipboard API is unavailable.
 */
export function useEventSelection({
  events,
  formatForClipboard,
}: UseEventSelectionOptions): UseEventSelectionReturn {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<ReadonlySet<number>>(new Set());
  /** Anchor index for shift-click range selection. */
  const anchorRef = useRef<number | undefined>(undefined);

  const selectedCount = useMemo(() => selectedIndices.size, [selectedIndices]);

  const enterSelectionMode = useCallback((initialIndex?: number) => {
    setIsSelecting(true);
    if (initialIndex !== undefined) {
      setSelectedIndices(new Set([initialIndex]));
      anchorRef.current = initialIndex;
    } else {
      setSelectedIndices(new Set());
      anchorRef.current = undefined;
    }
  }, []);

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIndices(new Set());
    anchorRef.current = undefined;
  }, []);

  const toggleEvent = useCallback(
    (index: number, shiftKey?: boolean) => {
      if (shiftKey && anchorRef.current !== undefined) {
        // Range selection: select all content-bearing events between anchor and index
        const start = Math.min(anchorRef.current, index);
        const end = Math.max(anchorRef.current, index);
        setSelectedIndices((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            if (i < events.length && isContentBearingEvent(events[i])) {
              next.add(i);
            }
          }
          return next;
        });
      } else {
        // Single toggle — exit selection mode if deselecting the last item
        setSelectedIndices((prev) => {
          const next = new Set(prev);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          if (next.size === 0) {
            setIsSelecting(false);
            anchorRef.current = undefined;
          }
          return next;
        });
        anchorRef.current = index;
      }
    },
    [events],
  );

  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < events.length; i++) {
      if (isContentBearingEvent(events[i])) {
        all.add(i);
      }
    }
    setSelectedIndices(all);
  }, [events]);

  const deselectAll = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const copySelected = useCallback(async (): Promise<boolean> => {
    const sorted = [...selectedIndices].sort((a, b) => a - b);
    const selectedEvents = sorted
      .filter((i) => i < events.length)
      .map((i) => events[i]);
    if (selectedEvents.length === 0) {
      return false;
    }
    const text = formatForClipboard(selectedEvents);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, [selectedIndices, events, formatForClipboard]);

  return {
    isSelecting,
    selectedIndices,
    selectedCount,
    enterSelectionMode,
    cancelSelection,
    toggleEvent,
    selectAll,
    deselectAll,
    copySelected,
  };
}
