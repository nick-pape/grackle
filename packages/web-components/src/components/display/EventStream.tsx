import { useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EventRenderer } from "./EventRenderer.js";
import { useSmartScroll } from "../../hooks/useSmartScroll.js";
import { ICON_MD } from "../../utils/iconSize.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import styles from "./EventStream.module.scss";

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
      <AlertTriangle size={ICON_MD} /> {eventsDropped.toLocaleString()} older event{eventsDropped === 1 ? "" : "s"} were dropped — only the most recent 5,000 are shown. Full history is available in the session log.
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
}

/**
 * Scrollable event stream with smart auto-scroll, direction toggle,
 * and animated entry for new events.
 */
export function EventStream({ events, eventsDropped, emptyState }: EventStreamProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isReversed, setIsReversed] = useState(readStoredDirection);
  const shouldReduceMotion = useReducedMotion();

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
  });

  const handleToggleDirection = (): void => {
    const next = !isReversed;
    setIsReversed(next);
    try {
      localStorage.setItem(DIRECTION_STORAGE_KEY, next ? "reversed" : "default");
    } catch { /* storage unavailable */ }
  };

  const animationDuration = shouldReduceMotion ? 0 : 0.2;
  const enterY = isReversed ? -8 : 8;

  return (
    <div className={styles.wrapper}>
      {/* Direction toggle */}
      <div className={styles.toolbar}>
        <button
          className={styles.directionToggle}
          onClick={handleToggleDirection}
          title={isReversed ? "Showing newest first" : "Showing oldest first"}
          aria-label={isReversed ? "Switch to newest at bottom" : "Switch to newest at top"}
          data-testid="direction-toggle"
        >
          {isReversed ? <ArrowDown size={ICON_MD} /> : <ArrowUp size={ICON_MD} />}
        </button>
      </div>

      {/* Scroll container */}
      <div ref={scrollRef} className={styles.scrollContainer} data-testid="event-stream-scroll">
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
                <EventRenderer event={event} toolUseCtx={event.toolUseCtx} settled={event.settled} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

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
            {isReversed ? <ArrowUp size={ICON_MD} /> : <ArrowDown size={ICON_MD} />} New events
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
