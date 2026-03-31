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
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}
