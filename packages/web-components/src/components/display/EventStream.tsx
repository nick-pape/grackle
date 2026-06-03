import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Virtuoso } from "react-virtuoso";
import { VirtualEventItem } from "./VirtualEventItem.js";
import { FloatingActionBar } from "./FloatingActionBar.js";
import { SessionPicker } from "./SessionPicker.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Tooltip } from "./Tooltip.js";
import { useEventSelection } from "../../hooks/useEventSelection.js";
import {
  isContentBearingEvent,
  formatEventsAsMarkdown,
  formatForwardEnvelope,
} from "../../utils/eventContent.js";
import type { ToastVariant } from "../../context/ToastContext.js";
import { ICON_MD } from "../../utils/iconSize.js";
import type { DisplayEvent } from "../../utils/sessionEvents.js";
import type { Session, Environment, PersonaData } from "../../hooks/types.js";
import styles from "./EventStream.module.scss";

/** Byte size threshold above which a large-message confirmation is shown (10 KB). */
const LARGE_MESSAGE_THRESHOLD_BYTES: number = 10 * 1024;

/** Active session statuses eligible as forward targets. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["running", "idle"]);

/** Pixel buffer rendered above/below the visible viewport (react-virtuoso measures in px). */
const VIRTUALIZER_OVERSCAN_PX: number = 150;

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
      <AlertTriangle size={ICON_MD} aria-hidden="true" /> {eventsDropped.toLocaleString()} older
      event{eventsDropped === 1 ? "" : "s"} were dropped — only the most recent 5,000 are shown.
      Full history is available in the session log.
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
  /** All known sessions (used to build the forward-target picker). */
  sessions?: Session[];
  /** ID of the session currently being viewed (excluded from forward picker). */
  currentSessionId?: string;
  /** All known environments (used to look up display names in the forward picker). */
  environments?: Environment[];
  /** All known personas (used to show persona name in the session picker). */
  personas?: PersonaData[];
  /**
   * Called when the user forwards selected events to another session.
   * Receives the target session ID and the formatted envelope text.
   */
  onForward?: (sessionId: string, text: string) => Promise<void>;
  /** Sandbox proxy origin URL for rendering MCP Apps widget events. */
  sandboxProxyUrl?: string;
  /**
   * Open a file in the live-docs pane (#1396). Wired by the page to
   * `documents.openDocument` with the environment bound. When provided,
   * `file://` links and tool-call file paths in the stream become clickable.
   */
  onOpenDocument?: (uri: string) => void;
}

/**
 * Scrollable event stream with smart auto-scroll, direction toggle,
 * animated entry for new events, hover actions, and multi-select mode.
 */
export function EventStream({
  events,
  eventsDropped,
  emptyState,
  onShowToast,
  sessions,
  currentSessionId,
  environments,
  personas,
  onForward,
  sandboxProxyUrl,
  onOpenDocument,
}: EventStreamProps): JSX.Element {
  const [isReversed, setIsReversed] = useState(readStoredDirection);
  const [isAtAnchor, setIsAtAnchor] = useState(true);

  // Timestamp of the last event in the previous render — events newer than this
  // get the entry animation. Survives MAX_EVENTS trimming (timestamps are monotonic).
  const prevLastTimestampRef = useRef<string>(
    events.length > 0 ? events[events.length - 1].timestamp : "",
  );

  // Forward flow state
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [confirmLargeMessage, setConfirmLargeMessage] = useState(false);
  const [pendingForward, setPendingForward] = useState<
    { sessionId: string; text: string } | undefined
  >(undefined);

  // Multi-select state
  const selection = useEventSelection({
    events,
    formatForClipboard: formatEventsAsMarkdown,
  });

  // Count of selectable events (for floating action bar)
  const totalSelectable = useMemo(() => events.filter(isContentBearingEvent).length, [events]);

  // Active sessions that can receive a forwarded message (excluding current)
  const forwardTargets = useMemo<Session[]>(() => {
    if (!sessions) {
      return [];
    }
    return sessions.filter((s) => ACTIVE_STATUSES.has(s.status) && s.id !== currentSessionId);
  }, [sessions, currentSessionId]);

  const displayEvents = useMemo(() => {
    if (!isReversed) {
      return events;
    }
    return [...events].reverse();
  }, [events, isReversed]);

  // Update the "last seen" timestamp after each render so new events animate.
  const prevLastTimestamp = prevLastTimestampRef.current;
  useEffect(() => {
    if (events.length > 0) {
      prevLastTimestampRef.current = events[events.length - 1].timestamp;
    }
  }, [events]);

  // Virtuoso ref for imperative scroll control
  const virtuosoRef = useRef<import("react-virtuoso").VirtuosoHandle>(null);

  const scrollToAnchor = useCallback((): void => {
    if (!virtuosoRef.current) {
      return;
    }
    if (isReversed) {
      virtuosoRef.current.scrollToIndex({ index: 0, behavior: "smooth" });
    } else {
      virtuosoRef.current.scrollToIndex({
        index: displayEvents.length - 1,
        align: "end",
        behavior: "smooth",
      });
    }
    setIsAtAnchor(true);
  }, [isReversed, displayEvents.length]);

  const handleToggleDirection = (): void => {
    const next = !isReversed;
    setIsReversed(next);
    try {
      localStorage.setItem(DIRECTION_STORAGE_KEY, next ? "reversed" : "default");
    } catch {
      /* storage unavailable */
    }
  };

  // Escape key exits selection mode, but not while a modal is open
  useEffect(() => {
    if (!selection.isSelecting) {
      return;
    }
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !showSessionPicker && !confirmLargeMessage) {
        selection.cancelSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [selection.isSelecting, selection.cancelSelection, showSessionPicker, confirmLargeMessage]);

  // Copy handler for the floating action bar
  const handleCopySelected = useCallback(async () => {
    const ok = await selection.copySelected();
    if (ok) {
      onShowToast?.(
        `Copied ${selection.selectedCount} message${selection.selectedCount === 1 ? "" : "s"} to clipboard`,
        "success",
      );
    }
  }, [selection, onShowToast]);

  /** Build the sorted list of selected DisplayEvents in chronological order. */
  const getSelectedEvents = useCallback((): DisplayEvent[] => {
    const sorted = [...selection.selectedIndices].sort((a, b) => a - b);
    return sorted.filter((i) => i < events.length).map((i) => events[i]);
  }, [selection.selectedIndices, events]);

  /**
   * Returns a human-readable label for a session by its ID.
   * Falls back to "this session" when sessionId is undefined/empty.
   */
  const getSessionLabel = useCallback(
    (sessionId: string | undefined): string => {
      if (!sessionId) {
        return "this session";
      }
      const session = sessions?.find((s) => s.id === sessionId);
      if (!session) {
        return sessionId.slice(0, 8);
      }
      const env = environments?.find((e) => e.id === session.environmentId);
      return env?.displayName ?? session.environmentId.slice(0, 8);
    },
    [sessions, environments],
  );

  /** Execute the actual forward after all confirmations. */
  const executeForward = useCallback(
    async (sessionId: string, text: string) => {
      if (!onForward) {
        return;
      }
      const targetLabel = getSessionLabel(sessionId);
      try {
        await onForward(sessionId, text);
        const count = selection.selectedCount;
        onShowToast?.(
          `Forwarded ${count} message${count === 1 ? "" : "s"} to ${targetLabel}`,
          "success",
        );
        selection.cancelSelection();
      } catch {
        onShowToast?.("Failed to forward messages", "error");
      }
    },
    [onForward, getSessionLabel, onShowToast, selection],
  );

  /** Called when the user picks a target session in the picker. */
  const handlePickSession = useCallback(
    (sessionId: string) => {
      setShowSessionPicker(false);

      const selectedEvents = getSelectedEvents();
      const sourceLabel = getSessionLabel(currentSessionId);
      const envelope = formatForwardEnvelope(sourceLabel, selectedEvents);

      if (new TextEncoder().encode(envelope).length > LARGE_MESSAGE_THRESHOLD_BYTES) {
        setPendingForward({ sessionId, text: envelope });
        setConfirmLargeMessage(true);
        return;
      }

      executeForward(sessionId, envelope).catch(() => {});
    },
    [getSelectedEvents, getSessionLabel, currentSessionId, executeForward],
  );

  const handleConfirmLargeMessage = useCallback(() => {
    setConfirmLargeMessage(false);
    if (pendingForward) {
      executeForward(pendingForward.sessionId, pendingForward.text).catch(() => {});
      setPendingForward(undefined);
    }
  }, [pendingForward, executeForward]);

  const handleCancelLargeMessage = useCallback(() => {
    setConfirmLargeMessage(false);
    setPendingForward(undefined);
  }, []);

  // Stabilized callbacks for VirtualEventItem via refs so identity never
  // changes, even though the underlying selection methods recreate on every
  // events change. Without this, every new event defeats React.memo.
  const enterSelectionRef = useRef(selection.enterSelectionMode);
  enterSelectionRef.current = selection.enterSelectionMode;
  const handleEnterSelection = useCallback((originalIndex: number) => {
    enterSelectionRef.current(originalIndex);
  }, []);

  const toggleEventRef = useRef(selection.toggleEvent);
  toggleEventRef.current = selection.toggleEvent;
  const handleToggleEvent = useCallback((originalIndex: number, shiftKey: boolean) => {
    toggleEventRef.current(originalIndex, shiftKey);
  }, []);

  const onShowToastRef = useRef(onShowToast);
  onShowToastRef.current = onShowToast;
  const handleItemCopied = useCallback(() => {
    onShowToastRef.current?.("Copied to clipboard", "success");
  }, []);

  const largeMessageSizeKb = pendingForward
    ? Math.round(new TextEncoder().encode(pendingForward.text).length / 1024)
    : 0;

  // Virtuoso followOutput: auto-scroll when at anchor, suppress during selection
  const followOutput = useCallback(
    (atBottom: boolean): false | "smooth" => {
      if (selection.isSelecting) {
        return false;
      }
      return atBottom ? "smooth" : false;
    },
    [selection.isSelecting],
  );

  // Render callback for Virtuoso — receives display index
  const itemContent = useCallback(
    (displayIndex: number): JSX.Element => {
      const event = displayEvents[displayIndex];
      const originalIndex = isReversed ? events.length - 1 - displayIndex : displayIndex;
      return (
        <VirtualEventItem
          event={event}
          originalIndex={originalIndex}
          isSelecting={selection.isSelecting}
          isSelected={selection.selectedIndices.has(originalIndex)}
          onSelect={handleEnterSelection}
          onToggle={handleToggleEvent}
          onCopied={handleItemCopied}
          sandboxProxyUrl={sandboxProxyUrl}
          onOpenDocument={onOpenDocument}
          isNew={event.timestamp > prevLastTimestamp}
          isReversed={isReversed}
        />
      );
    },
    [
      displayEvents,
      events.length,
      isReversed,
      selection.isSelecting,
      selection.selectedIndices,
      handleEnterSelection,
      handleToggleEvent,
      handleItemCopied,
      sandboxProxyUrl,
      onOpenDocument,
      prevLastTimestamp,
    ],
  );

  // Stable key per item — no indices, survives MAX_EVENTS trimming
  const computeItemKey = useCallback(
    (displayIndex: number): string => {
      const event = displayEvents[displayIndex];
      return `${event.sessionId}-${event.timestamp}`;
    },
    [displayEvents],
  );

  // Anchor tracking callbacks — bottom for normal mode, top for reversed
  const handleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      if (!isReversed) {
        setIsAtAnchor(atBottom);
      }
    },
    [isReversed],
  );

  const handleAtTopChange = useCallback(
    (atTop: boolean) => {
      if (isReversed) {
        setIsAtAnchor(atTop);
      }
    },
    [isReversed],
  );

  // In reversed mode, auto-scroll to top when new events prepend
  useEffect(() => {
    if (isReversed && isAtAnchor && !selection.isSelecting && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 0, behavior: "smooth" });
    }
  }, [displayEvents.length, isReversed, isAtAnchor, selection.isSelecting]);

  // Custom Scroller that applies padding and data-testid inside Virtuoso's
  // scroll viewport. Virtuoso manages overflow; we only add visual padding.
  const scrollerClassName = `${styles.scrollerPadding} ${selection.isSelecting ? styles.selectingPadding : ""}`;
  const CustomScroller = useMemo(
    () =>
      forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
        <div
          {...props}
          ref={ref}
          className={`${props.className ?? ""} ${scrollerClassName}`}
          data-testid="event-stream-scroll"
        />
      )),
    [scrollerClassName],
  );

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
            {isReversed ? (
              <ArrowDown size={ICON_MD} aria-hidden="true" />
            ) : (
              <ArrowUp size={ICON_MD} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      </div>

      {events.length === 0 && emptyState}
      <EventOverflowBanner eventsDropped={eventsDropped} />

      {/* Virtuoso owns the scroll container — handles auto-scroll,
          dynamic heights, and initial scroll position natively. */}
      <Virtuoso
        key={String(isReversed)}
        ref={virtuosoRef}
        className={styles.scrollContainer}
        totalCount={displayEvents.length}
        overscan={VIRTUALIZER_OVERSCAN_PX}
        computeItemKey={computeItemKey}
        itemContent={itemContent}
        followOutput={isReversed ? false : followOutput}
        initialTopMostItemIndex={isReversed ? 0 : Math.max(0, displayEvents.length - 1)}
        atBottomStateChange={handleAtBottomChange}
        atTopStateChange={handleAtTopChange}
        components={{ Scroller: CustomScroller }}
      />

      {/* Floating action bar for multi-select mode */}
      <AnimatePresence>
        {selection.isSelecting && (
          <FloatingActionBar
            selectedCount={selection.selectedCount}
            totalSelectable={totalSelectable}
            onSelectAll={selection.selectAll}
            onDeselectAll={selection.deselectAll}
            onCopy={() => {
              handleCopySelected().catch(() => {});
            }}
            onForward={
              onForward !== undefined
                ? () => {
                    setShowSessionPicker(true);
                  }
                : undefined
            }
            forwardDisabled={forwardTargets.length === 0}
            onCancel={selection.cancelSelection}
          />
        )}
      </AnimatePresence>

      {/* Session picker for forwarding */}
      <SessionPicker
        isOpen={showSessionPicker}
        sessions={forwardTargets}
        environments={environments ?? []}
        personas={personas}
        onSelect={handlePickSession}
        onCancel={() => {
          setShowSessionPicker(false);
        }}
      />

      {/* Large message confirmation */}
      <ConfirmDialog
        isOpen={confirmLargeMessage}
        title="Send large message?"
        description={`This will forward a large message (${largeMessageSizeKb} KB). Continue?`}
        confirmLabel="Send"
        onConfirm={handleConfirmLargeMessage}
        onCancel={handleCancelLargeMessage}
      />

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
            {isReversed ? (
              <ArrowUp size={ICON_MD} aria-hidden="true" />
            ) : (
              <ArrowDown size={ICON_MD} aria-hidden="true" />
            )}{" "}
            New events
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
