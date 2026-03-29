import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EventRenderer } from "./EventRenderer.js";
import { EventHoverRow } from "./EventHoverRow.js";
import { FloatingActionBar } from "./FloatingActionBar.js";
import { Tooltip } from "./Tooltip.js";
import { useSmartScroll } from "../../hooks/useSmartScroll.js";
import { useEventSelection } from "../../hooks/useEventSelection.js";
import { isContentBearingEvent, getEventCopyText, formatEventsAsMarkdown } from "../../utils/eventContent.js";
import type { ToastVariant } from "../../context/ToastContext.js";
import { ICON_MD } from "../../utils/iconSize.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import type { SessionEvent } from "../../hooks/types.js";
import styles from "./EventStream.module.scss";

/** Build a descriptive label for the selection checkbox aria-label. */
function buildCheckboxLabel(event: SessionEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  switch (event.eventType) {
    case "text":
    case "output":
      return `Select message from assistant at ${time}`;
    case "user_input":
      return `Select message from user at ${time}`;
    case "tool_result":
    case "tool_use":
      return `Select tool event at ${time}`;
    case "error":
      return `Select error at ${time}`;
    default:
      return `Select event at ${time}`;
  }
}

/** localStorage key for persisting the direction preference. */
const DIRECTION_STORAGE_KEY: string = "grackle-stream-direction";

/** Read initial direction from localStorage. */
function readStoredDirection(): boolean {
  try {
    return localStorage.getItem(DIRECTION_STORAGE_KEY) === "reversed";
  } catch {
    return false;
  }
}

/** Overflow warning banner shown when events exceed the in-memory cap. */
function EventOverflowBanner({ eventsDropped }: { eventsDropped: number }): JSX.Element {
  if (eventsDropped <= 0) {
    return <></>;
  }
  return (
    <div className={styles.eventOverflowWarning} role="alert">
      <AlertTriangle size={ICON_MD} aria-hidden="true" /> {eventsDropped.toLocaleString()} older event{eventsDropped === 1 ? "" : "s"} were dropped — only the most recent 5,000 are shown. Full history is available in the session log.
    </div>
  );
}

/** Props for the EventStream component. */
interface EventStreamProps {
  /** Events to render. */
  events: DisplayEvent[];
  /** Number of events dropped due to the in-memory cap. */
  eventsDropped: number;
  /** Custom empty state content (e.g., CTA button or waiting message). */
  emptyState?: ReactNode;
  /** Toast callback for copy feedback. If omitted, no toast is shown. */
  onShowToast?: (message: string, variant?: ToastVariant) => void;
}

/**
 * Scrollable event stream with smart auto-scroll, direction toggle,
 * animated entry for new events, hover actions, and multi-select mode.
 */
export function EventStream({ events, eventsDropped, emptyState, onShowToast }: EventStreamProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isReversed, setIsReversed] = useState(readStoredDirection);
  const shouldReduceMotion = useReducedMotion();

  // Multi-select state
  const selection = useEventSelection({
    events,
    formatForClipboard: formatEventsAsMarkdown,
  });

  // Count of selectable events (for floating action bar)
  const totalSelectable = useMemo(
    () => events.filter(isContentBearingEvent).length,
    [events],
  );

  const displayEvents = useMemo(() => {
    if (!isReversed) {
      return events;
    }
    return [...events].reverse();
  }, [events, isReversed]);

  const { isAtAnchor, scrollToAnchor } = useSmartScroll({
    scrollRef,
    contentLength: events.length,
    isReversed,
    paused: selection.isSelecting,
  });

  const handleToggleDirection = (): void => {
    const next = !isReversed;
    setIsReversed(next);
    try {
      localStorage.setItem(DIRECTION_STORAGE_KEY, next ? "reversed" : "default");
    } catch { /* storage unavailable */ }
  };

  // Escape key exits selection mode
  useEffect(() => {
    if (!selection.isSelecting) {
      return;
    }
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        selection.cancelSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [selection.isSelecting, selection.cancelSelection]);

  // Copy handler for the floating action bar
  const handleCopySelected = useCallback(async () => {
    const ok = await selection.copySelected();
    if (ok) {
      onShowToast?.(`Copied ${selection.selectedCount} message${selection.selectedCount === 1 ? "" : "s"} to clipboard`, "success");
    }
  }, [selection, onShowToast]);

  const animationDuration = shouldReduceMotion ? 0 : 0.2;
  const enterY = isReversed ? -8 : 8;

  return (
    <div className={styles.wrapper}>
      {/* Direction toggle */}
      <div className={styles.toolbar}>
        <Tooltip text={isReversed ? "Showing newest first" : "Showing oldest first"}>
          <button
            className={styles.directionToggle}
            onClick={handleToggleDirection}
            aria-label={isReversed ? "Switch to newest at bottom" : "Switch to newest at top"}
            data-testid="direction-toggle"
          >
            {isReversed ? <ArrowDown size={ICON_MD} aria-hidden="true" /> : <ArrowUp size={ICON_MD} aria-hidden="true" />}
          </button>
        </Tooltip>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className={`${styles.scrollContainer} ${selection.isSelecting ? styles.selectingPadding : ""}`}
        data-testid="event-stream-scroll"
      >
        {events.length === 0 && emptyState}
        <EventOverflowBanner eventsDropped={eventsDropped} />
        <AnimatePresence initial={false}>
          {displayEvents.map((event, displayIndex) => {
            // Use original index for stable keys regardless of direction
            const originalIndex = isReversed ? events.length - 1 - displayIndex : displayIndex;
            return (
              <motion.div
                key={`${event.sessionId}-${event.timestamp}-${originalIndex}`}
                initial={{ opacity: 0, y: enterY }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: animationDuration, ease: "easeOut" }}
              >
                <EventHoverRow
                  copyText={getEventCopyText(event)}
                  isContentBearing={isContentBearingEvent(event)}
                  isSelecting={selection.isSelecting}
                  isSelected={selection.selectedIndices.has(originalIndex)}
                  checkboxLabel={buildCheckboxLabel(event)}
                  onSelect={() => { selection.enterSelectionMode(originalIndex); }}
                  onToggle={(shiftKey) => { selection.toggleEvent(originalIndex, shiftKey); }}
                  onCopied={() => { onShowToast?.("Copied to clipboard", "success"); }}
                >
                  <EventRenderer event={event} toolUseCtx={event.toolUseCtx} settled={event.settled} />
                </EventHoverRow>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Floating action bar for multi-select mode */}
      <AnimatePresence>
        {selection.isSelecting && (
          <FloatingActionBar
            selectedCount={selection.selectedCount}
            totalSelectable={totalSelectable}
            onSelectAll={selection.selectAll}
            onDeselectAll={selection.deselectAll}
            onCopy={() => { handleCopySelected().catch(() => {}); }}
            onCancel={selection.cancelSelection}
          />
        )}
      </AnimatePresence>

      {/* Floating "scroll to anchor" button */}
      <AnimatePresence>
        {!isAtAnchor && (
          <motion.button
            className={`${styles.scrollToAnchor} ${isReversed ? styles.scrollToAnchorTop : styles.scrollToAnchorBottom}`}
            onClick={scrollToAnchor}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            aria-label="Scroll to latest"
            data-testid="scroll-to-anchor"
          >
            {isReversed ? <ArrowUp size={ICON_MD} aria-hidden="true" /> : <ArrowDown size={ICON_MD} aria-hidden="true" />} New events
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
