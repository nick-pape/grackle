/** Return the current time as an ISO 8601 string. */
export function serverTimestamp(): string {
  return new Date().toISOString();
}

/** Return the current time as epoch milliseconds. */
export function serverEpochMs(): number {
  return Date.now();
}
