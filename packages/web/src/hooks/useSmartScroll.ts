import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isNearAnchor, computeScrollCompensation, SCROLL_ANCHOR_THRESHOLD_PX } from "../utils/scrollUtils.js";

/** Options for the useSmartScroll hook. */
interface UseSmartScrollOptions {
  /** Ref to the scrollable container element. */
  // eslint-disable-next-line @rushstack/no-new-null
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Length of the content list — triggers scroll checks on change. */
  contentLength: number;
  /** Whether newest-at-top mode is active (anchor is top instead of bottom). */
  isReversed: boolean;
}

/** Return value from the useSmartScroll hook. */
interface UseSmartScrollReturn {
  /** Whether the user is currently at the anchor position (bottom or top). */
  isAtAnchor: boolean;
  /** Smooth-scrolls to the anchor and re-enables auto-scroll. */
  scrollToAnchor: () => void;
}

/**
 * Smart auto-scroll hook that respects user reading position.
 *
 * - Auto-scrolls to anchor (bottom or top) when new content arrives and user is at anchor.
 * - Detects when user scrolls away from anchor and disables auto-scroll.
 * - Provides a callback to manually scroll back to anchor.
 * - In reverse mode, compensates scrollTop to prevent viewport shift from prepended content.
 */
export function useSmartScroll({
  scrollRef,
  contentLength,
  isReversed,
}: UseSmartScrollOptions): UseSmartScrollReturn {
  const [isAtAnchor, setIsAtAnchor] = useState(true);
  const prevScrollHeightRef = useRef<number>(0);
  const mountedRef = useRef(false);
  const rafIdRef = useRef<number>(0);

  // Throttled scroll listener — uses rAF to avoid excessive React work during fast scrolling.
  // Only calls setState when the boolean actually changes.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    let lastKnownValue: boolean = true;

    const handleScroll = (): void => {
      if (rafIdRef.current) {
        return;
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0;
        const near = isNearAnchor(
          element.scrollTop,
          element.scrollHeight,
          element.clientHeight,
          isReversed,
          SCROLL_ANCHOR_THRESHOLD_PX,
        );
        if (near !== lastKnownValue) {
          lastKnownValue = near;
          setIsAtAnchor(near);
        }
      });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleScroll);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, [scrollRef, isReversed]);

  // Initial scroll — useLayoutEffect to avoid flash before paint
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || mountedRef.current) {
      return;
    }
    mountedRef.current = true;
    if (isReversed) {
      element.scrollTop = 0;
    } else {
      element.scrollTop = element.scrollHeight;
    }
    setIsAtAnchor(true);
  }, [scrollRef, isReversed]);

  // Auto-scroll on new content + reverse-mode compensation.
  // prevScrollHeightRef is captured at the END of this effect so the NEXT
  // invocation sees the prior commit's scrollHeight (not the current one).
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    if (isReversed && !isAtAnchor) {
      // Compensate scrollTop to prevent viewport shift from prepended content
      const compensation = computeScrollCompensation(
        prevScrollHeightRef.current,
        element.scrollHeight,
      );
      if (compensation > 0) {
        element.scrollTop += compensation;
      }
    }

    if (isAtAnchor) {
      if (isReversed) {
        element.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      }
    }

    // Update prevScrollHeight AFTER applying compensation/auto-scroll
    // so the next render can compute the delta correctly.
    prevScrollHeightRef.current = element.scrollHeight;
  }, [contentLength, isAtAnchor, isReversed, scrollRef]);

  const scrollToAnchor = useCallback((): void => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const target = isReversed ? 0 : element.scrollHeight;
    element.scrollTo({ top: target, behavior: "smooth" });
    setIsAtAnchor(true);
  }, [scrollRef, isReversed]);

  return { isAtAnchor, scrollToAnchor };
}
