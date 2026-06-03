import { memo, useCallback, type JSX } from "react";
import { EventRenderer } from "./EventRenderer.js";
import { EventHoverRow } from "./EventHoverRow.js";
import { isContentBearingEvent, getEventCopyText } from "../../utils/eventContent.js";
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

/** Props for the virtualized event item. */
export interface VirtualEventItemProps {
  /** The display event to render. */
  event: DisplayEvent;
  /** Original index in the chronological events array (used for selection). */
  originalIndex: number;
  /** Whether multi-select mode is active. */
  isSelecting: boolean;
  /** Whether this event is currently selected. */
  isSelected: boolean;
  /** Called when the user clicks the Select hover action. */
  onSelect: (originalIndex: number) => void;
  /** Called when the user toggles selection (checkbox click or row click). */
  onToggle: (originalIndex: number, shiftKey: boolean) => void;
  /** Called after a successful single-event copy from the hover row. */
  onCopied: () => void;
  /** Sandbox proxy origin URL for rendering MCP Apps widget events. */
  sandboxProxyUrl?: string;
  /** Open a file in the live-docs pane. */
  onOpenDocument?: (uri: string) => void;
  /** Whether this event is newly appended (triggers entry animation). */
  isNew: boolean;
  /** Whether the stream is in reversed (newest-at-top) mode. */
  isReversed: boolean;
}

/** Custom equality check for React.memo — avoids re-rendering unchanged items. */
/** Compare toolUseCtx by fields (pairToolEvents recreates these objects each render). */
function toolCtxEqual(a: DisplayEvent["toolUseCtx"], b: DisplayEvent["toolUseCtx"]): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.tool === b.tool && a.detailedResult === b.detailedResult && a.args === b.args;
}

/** Compare events by identity — reference first, then stable fields as fallback. */
function eventsEqual(a: DisplayEvent, b: DisplayEvent): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.sessionId === b.sessionId &&
    a.timestamp === b.timestamp &&
    a.eventType === b.eventType &&
    a.content === b.content &&
    toolCtxEqual(a.toolUseCtx, b.toolUseCtx) &&
    a.settled === b.settled
  );
}

function arePropsEqual(
  prev: Readonly<VirtualEventItemProps>,
  next: Readonly<VirtualEventItemProps>,
): boolean {
  return (
    eventsEqual(prev.event, next.event) &&
    prev.originalIndex === next.originalIndex &&
    prev.isSelecting === next.isSelecting &&
    prev.isSelected === next.isSelected &&
    prev.onSelect === next.onSelect &&
    prev.onToggle === next.onToggle &&
    prev.onCopied === next.onCopied &&
    prev.sandboxProxyUrl === next.sandboxProxyUrl &&
    prev.onOpenDocument === next.onOpenDocument &&
    prev.isNew === next.isNew &&
    prev.isReversed === next.isReversed
  );
}

/**
 * Memoized event row for the virtualized EventStream.
 * Wraps EventHoverRow + EventRenderer. Measurement and positioning are
 * handled by the parent VirtualList component.
 */
export const VirtualEventItem: React.NamedExoticComponent<VirtualEventItemProps> = memo(
  function VirtualEventItem({
    event,
    originalIndex,
    isSelecting,
    isSelected,
    onSelect,
    onToggle,
    onCopied,
    sandboxProxyUrl,
    onOpenDocument,
    isNew,
    isReversed,
  }: VirtualEventItemProps): JSX.Element {
    const handleSelect = useCallback(() => {
      onSelect(originalIndex);
    }, [onSelect, originalIndex]);

    const handleToggle = useCallback(
      (shiftKey: boolean) => {
        onToggle(originalIndex, shiftKey);
      },
      [onToggle, originalIndex],
    );

    const copyText = getEventCopyText(event);
    const contentBearing = isContentBearingEvent(event);
    const checkboxLabel = buildCheckboxLabel(event);

    const animationClass = isNew
      ? isReversed
        ? styles.eventFadeInReversed
        : styles.eventFadeIn
      : undefined;

    return (
      <div className={animationClass}>
        <EventHoverRow
          copyText={copyText}
          isContentBearing={contentBearing}
          isSelecting={isSelecting}
          isSelected={isSelected}
          checkboxLabel={checkboxLabel}
          onSelect={handleSelect}
          onToggle={handleToggle}
          onCopied={onCopied}
        >
          <EventRenderer
            event={event}
            toolUseCtx={event.toolUseCtx}
            settled={event.settled}
            sandboxProxyUrl={sandboxProxyUrl}
            onOpenDocument={onOpenDocument}
          />
        </EventHoverRow>
      </div>
    );
  },
  arePropsEqual,
);
