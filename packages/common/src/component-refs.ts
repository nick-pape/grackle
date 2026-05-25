/**
 * Static extraction of component references from an agent-authored JSX body, for
 * GenUX cross-component composition (#1270).
 *
 * A component references another registry component simply by using its name as a
 * JSX tag (`<RevenueChart period="Q1"/>`). The composition resolver scans the body
 * for capitalized JSX tags and keeps the ones that resolve to a workspace component
 * (built-ins and unknown names are filtered by the resolver, not here).
 */

/**
 * Matches the start of a JSX element with a capitalized, plain-identifier tag (a
 * component, not an HTML element). The trailing negative lookahead rejects
 * member/namespaced forms like `<Foo.Bar/>` or `<Foo:Bar/>` — the captured name
 * must be followed by a non-identifier, non-`.`, non-`:` character (e.g. space,
 * `/`, `>`), so `Foo` in `<Foo.Bar/>` is not treated as a reference.
 */
const COMPONENT_TAG_RE: RegExp = /<\s*([A-Z][A-Za-z0-9_]*)(?![A-Za-z0-9_.:])/g;

/**
 * Extract the unique capitalized JSX tag names used as elements in `source`, in
 * first-seen order. Lowercase/HTML tags (`<div>`) are ignored. This is a
 * lightweight scan (not a full parser); the resolver only acts on names that
 * actually resolve to a registry component, so false positives are harmless.
 */
export function extractComponentReferenceNames(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(COMPONENT_TAG_RE)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
