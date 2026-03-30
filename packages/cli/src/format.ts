/** Format a token count in compact notation (e.g. 1952 → "2.0k", 1234567 → "1.2M"). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const kValue = Number((n / 1_000).toFixed(1));
    if (kValue >= 1_000) {
      return `${(n / 1_000_000).toFixed(1)}M`;
    }
    return `${kValue.toFixed(1)}k`;
  }
  return String(n);
}

/** Format a USD cost for display (e.g. 0.005 → "$0.0050", 1.23 → "$1.23"). */
export function formatCost(usd: number): string {
  if (usd === 0) {
    return "-";
  }
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

/** Format a cost value for budget display, showing "$0.00" for zero instead of "-". */
function formatBudgetCost(usd: number): string {
  if (usd === 0) {
    return "$0.00";
  }
  return formatCost(usd);
}

/** Format a budget display: "used / total" with appropriate formatting for tokens or cost. */
export function formatBudget(used: number, budget: number, type: "token" | "cost"): string {
  if (type === "token") {
    return `${formatTokens(used)} / ${formatTokens(budget)}`;
  }
  return `${formatBudgetCost(used)} / ${formatBudgetCost(budget / 100000)}`;
}
