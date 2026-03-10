/** Convert arbitrary text to a URL-safe slug (lowercase, hyphens, max 40 chars). */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
