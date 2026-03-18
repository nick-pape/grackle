/**
 * Pure scroll-math utilities for the smart-scroll feature.
 * No DOM or React dependencies — easy to unit test.
 */

/** Pixel threshold for "near anchor" detection. */
export const SCROLL_ANCHOR_THRESHOLD_PX: number = 50;

/**
 * Whether the scroll position is within threshold of the anchor point.
 *
 * @param scrollTop - Current scrollTop of the container
 * @param scrollHeight - Total scrollable height of the container
 * @param clientHeight - Visible height of the container
 * @param isReversed - If true, anchor is at the top; otherwise at bottom
 * @param threshold - Override the default 50px threshold
 * @returns True if the scroll position is near the anchor
 */
export function isNearAnchor(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  isReversed: boolean,
  threshold: number = SCROLL_ANCHOR_THRESHOLD_PX,
): boolean {
  if (isReversed) {
    // Anchor is at the top — near anchor when scrollTop is small
    return scrollTop < threshold;
  }
  // Anchor is at the bottom — near anchor when close to max scroll
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom < threshold;
}

/**
 * Compute the scrollTop delta needed to compensate for prepended content.
 * Used in reverse mode to prevent viewport shift when new items appear at top.
 *
 * @param previousScrollHeight - scrollHeight before the render
 * @param currentScrollHeight - scrollHeight after the render
 * @returns Positive delta to add to scrollTop, or 0 if no compensation needed
 */
export function computeScrollCompensation(
  previousScrollHeight: number,
  currentScrollHeight: number,
): number {
  const delta = currentScrollHeight - previousScrollHeight;
  return delta > 0 ? delta : 0;
}
