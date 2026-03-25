/**
 * Schedule expression parsing and next-run-time computation.
 *
 * Supports two formats:
 * - **Interval shorthand**: `"<number><unit>"` where unit is s/m/h/d (min 10s)
 * - **Cron expressions**: Standard 5-field cron syntax via `cron-parser`
 */

import cronParser from "cron-parser";

const INTERVAL_RE: RegExp = /^(\d+)([smhd])$/;
const MINIMUM_INTERVAL_MS: number = 10_000; // 10 seconds

const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse an interval shorthand expression to milliseconds.
 *
 * @param expr - e.g. "30s", "5m", "1h", "1d"
 * @returns Duration in milliseconds
 * @throws If the expression is invalid or below the minimum (10s)
 */
export function parseDuration(expr: string): number {
  const match = INTERVAL_RE.exec(expr);
  if (!match) {
    throw new Error(
      `Invalid interval expression: "${expr}". Expected format: <number><s|m|h|d> (e.g. "30s", "5m")`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = value * UNIT_TO_MS[unit];
  if (ms <= 0) {
    throw new Error(`Interval must be positive: "${expr}"`);
  }
  if (ms < MINIMUM_INTERVAL_MS) {
    throw new Error(
      `Interval "${expr}" (${ms}ms) is below the minimum of ${MINIMUM_INTERVAL_MS}ms (10s)`,
    );
  }
  return ms;
}

/**
 * Detect whether an expression is interval shorthand (vs. cron).
 *
 * @param expr - Schedule expression string
 * @returns true if the expression matches interval shorthand format
 */
export function isIntervalExpression(expr: string): boolean {
  return INTERVAL_RE.test(expr);
}

/**
 * Compute the next run time for a schedule expression.
 *
 * For intervals: `max(lastRunAt + interval, now + interval)` — anchored to
 * prevent drift, capped to prevent burst-firing after downtime.
 *
 * For cron: next occurrence after now.
 *
 * @param expr - Schedule expression (interval or cron)
 * @param lastRunAt - ISO timestamp of the last fire (undefined for first fire)
 * @returns ISO timestamp of the next fire
 */
export function computeNextRunAt(expr: string, lastRunAt?: string): string {
  const now = Date.now();

  if (isIntervalExpression(expr)) {
    const intervalMs = parseDuration(expr);
    const nowPlusInterval = now + intervalMs;

    if (lastRunAt) {
      const lastRunMs = new Date(lastRunAt).getTime();
      const anchored = lastRunMs + intervalMs;
      // Anchored: use lastRunAt + interval if it's in the future (prevents drift).
      // If it's in the past (server was down), cap to now + interval (prevents burst).
      if (anchored > now) {
        return new Date(anchored).toISOString();
      }
      return new Date(nowPlusInterval).toISOString();
    }

    return new Date(nowPlusInterval).toISOString();
  }

  // Cron expression: compute next occurrence after now
  const interval = cronParser.parseExpression(expr, { utc: true });
  return interval.next().toISOString();
}

/**
 * Validate a schedule expression. Throws if invalid.
 *
 * @param expr - Schedule expression to validate
 * @throws If the expression is neither valid interval shorthand nor valid cron
 */
export function validateExpression(expr: string): void {
  if (!expr) {
    throw new Error("Schedule expression cannot be empty");
  }

  if (isIntervalExpression(expr)) {
    // parseDuration validates format and minimum
    parseDuration(expr);
    return;
  }

  // Try to parse as cron
  try {
    cronParser.parseExpression(expr, { utc: true });
  } catch {
    throw new Error(
      `Invalid schedule expression: "${expr}". Must be interval shorthand (e.g. "30s", "5m") or 5-field cron (e.g. "0 9 * * MON")`,
    );
  }
}
