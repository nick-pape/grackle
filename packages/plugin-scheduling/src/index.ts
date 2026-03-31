// ─── Plugin Entry Point ──────────────────────────────────────
export { createSchedulingPlugin } from "./scheduling-plugin.js";

// ─── Reconciliation Phase ────────────────────────────────────
export { createCronPhase } from "./cron-phase.js";
export type { CronPhaseDeps } from "./cron-phase.js";

// ─── Expression Utilities ────────────────────────────────────
export { validateExpression, computeNextRunAt, parseDuration, isIntervalExpression } from "./schedule-expression.js";
