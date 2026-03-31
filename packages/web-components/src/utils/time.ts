/**
 * Formats an ISO timestamp string as a human-readable relative time.
 *
 * Examples:
 *   "just now"   (< 1 minute ago)
 *   "5m ago"     (< 1 hour ago)
 *   "2h ago"     (< 24 hours ago)
 *   "yesterday"  (1–2 days ago)
 *   "3 days ago" (2–7 days ago)
 *   "Feb 27"     (> 7 days ago, same year)
 *   "Feb 27 2025" (different year)
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  // Older than a week — show a short date
  const sameYear = date.getFullYear() === now.getFullYear();
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  return sameYear ? `${month} ${day}` : `${month} ${day} ${date.getFullYear()}`;
}

/**
 * Formats an ISO timestamp string as a human-readable countdown to a future event.
 *
 * Examples:
 *   "in 45s"     (< 1 minute away)
 *   "in 5m"      (< 1 hour away)
 *   "in 2h"      (< 24 hours away)
 *   "in 3 days"  (< 7 days away)
 *   "Feb 27"     (> 7 days away, same year)
 *
 * Returns "overdue" if the timestamp is in the past.
 */
export function formatCountdown(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "overdue";
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return `in ${diffSeconds}s`;
  }
  if (diffMinutes < 60) {
    return `in ${diffMinutes}m`;
  }
  if (diffHours < 24) {
    return `in ${diffHours}h`;
  }
  if (diffDays < 7) {
    return `in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  }

  // Further out — show a short date
  const sameYear = date.getFullYear() === now.getFullYear();
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  return sameYear ? `${month} ${day}` : `${month} ${day} ${date.getFullYear()}`;
}
