import { type ReactNode, type RefObject, type JSX, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** Default estimated item height in pixels. */
const DEFAULT_ESTIMATE_SIZE: number = 80;

/** Default number of off-screen items to render above/below the visible area. */
const DEFAULT_OVERSCAN: number = 5;

/** Props for the VirtualList component. */
export interface VirtualListProps<T> {
  /** Items to render. */
  items: T[];
  /** Ref to the scrollable container element (owned by the consumer). */
  // eslint-disable-next-line @rushstack/no-new-null -- React ref type
  scrollRef: RefObject<HTMLElement | null>;
  /** Render callback for each visible item. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated average item height in pixels. Corrected by measurement after first paint. */
  estimateSize?: number;
  /** Number of off-screen items to render above/below the visible area. */
  overscan?: number;
  /** Stable key for each item. Defaults to the array index. */
  getItemKey?: (index: number, item: T) => string | number;
  /** Optional CSS class on the outer positioned container. */
  className?: string;
}

/**
 * Generic virtualized list that renders only visible items plus overscan.
 *
 * The consumer owns the scroll container and passes a ref to it. This component
 * renders a positioned container sized to the total virtual height, with each
 * visible item absolutely positioned via `transform: translateY`. Items are
 * measured dynamically via `@tanstack/react-virtual`'s `measureElement` so
 * variable-height rows are fully supported.
 *
 * @example
 * ```tsx
 * <div ref={scrollRef} style={{ overflow: "auto", height: 400 }}>
 *   <VirtualList
 *     items={events}
 *     scrollRef={scrollRef}
 *     renderItem={(event, i) => <EventRow event={event} />}
 *     getItemKey={(i, event) => event.id}
 *   />
 * </div>
 * ```
 */
export function VirtualList<T>({
  items,
  scrollRef,
  renderItem,
  estimateSize = DEFAULT_ESTIMATE_SIZE,
  overscan = DEFAULT_OVERSCAN,
  getItemKey,
  className,
}: VirtualListProps<T>): JSX.Element {
  // Force a re-render after mount so the virtualizer picks up the scroll
  // element. On first render scrollRef.current is null (ref not yet attached);
  // this ensures a second render where it's available.
  const [, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: getItemKey ? (index: number) => getItemKey(index, items[index]) : undefined,
  });

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
      className={className}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => (
        <div
          key={virtualItem.key}
          ref={virtualizer.measureElement}
          data-index={virtualItem.index}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          {renderItem(items[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
}
