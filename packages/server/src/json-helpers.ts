/**
 * Safely parse a JSON string that is expected to contain an array of strings.
 * Returns the parsed array on success, or an empty array if the value is
 * null, undefined, empty, or contains malformed JSON.
 */
// eslint-disable-next-line @rushstack/no-new-null
export function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}
