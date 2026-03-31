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

/** Format an integer millicent cost for display (e.g. 500 → "$0.0050", 123000 → "$1.23"). */
export function formatCost(millicents: number): string {
  if (millicents === 0) {
    return "-";
  }
  const usd = millicents / 100_000;
  if (usd < 0.01) {
    const decimals = millicents < 5 ? 5 : 4;
    return `$${usd.toFixed(decimals)}`;
  }
  return `$${usd.toFixed(2)}`;
}

/** Format a millicent cost value for budget display, showing "$0.00" for zero instead of "-". */
function formatBudgetCost(millicents: number): string {
  if (millicents === 0) {
    return "$0.00";
  }
  return formatCost(millicents);
}

/** Format a budget display: "used / total" with appropriate formatting for tokens or cost. */
export function formatBudget(used: number, budget: number, type: "token" | "cost"): string {
  if (type === "token") {
    return `${formatTokens(used)} / ${formatTokens(budget)}`;
  }
  return `${formatBudgetCost(used)} / ${formatBudgetCost(budget)}`;
}
