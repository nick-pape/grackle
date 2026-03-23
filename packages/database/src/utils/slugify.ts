/**
 * Converts arbitrary text into a URL-safe slug.
 *
 * The conversion process:
 * 1. Lowercases the entire string.
 * 2. Replaces any sequence of non-alphanumeric characters with a single hyphen.
 * 3. Strips leading and trailing hyphens.
 * 4. Truncates the result to a maximum of 40 characters.
 *
 * @param text - The input string to slugify (e.g. a task title or workspace name).
 * @returns A lowercase, hyphen-separated, URL-safe string of at most 40 characters.
 *
 * @example
 * slugify("Hello World!")        // "hello-world"
 * slugify("  My New Task  ")     // "my-new-task"
 * slugify("A very long title that exceeds the forty character limit")
 * // "a-very-long-title-that-exceeds-the-forty"
 */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
