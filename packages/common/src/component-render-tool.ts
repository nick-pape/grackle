/**
 * Naming for dynamic component render tools (#1272).
 *
 * A *promoted* registered component is surfaced as its own MCP tool named
 * `render_<slug(name)>` whose `inputSchema` is the component's prop schema. The
 * MCP server synthesizes these per workspace at `tools/list` time and dispatches
 * calls back to the shared render path. Both sides MUST derive the tool name with
 * {@link componentRenderToolName} so the tool an agent sees is the tool it calls.
 */

/**
 * Reserved prefix for dynamic component render tools. No statically-registered
 * MCP tool may start with this (enforced by a test); the server uses it to route
 * a `tools/call` to the dynamic component dispatcher.
 */
export const RENDER_TOOL_PREFIX: string = "render_";

/** Max length of the slug portion of a render tool name (keeps tool names sane). */
const MAX_RENDER_TOOL_SLUG_CHARS: number = 64;

/**
 * Derive the dynamic render-tool name for a component name, or `undefined` when
 * the name has no usable characters (the component is then not promotable to a
 * tool). The slug keeps `[A-Za-z0-9_]`, collapses every other run to a single
 * `_`, and trims leading/trailing underscores — yielding a valid MCP tool name.
 *
 * @example componentRenderToolName("Revenue Chart") // "render_Revenue_Chart"
 */
export function componentRenderToolName(name: string): string | undefined {
  // Replace every run of disallowed characters with a single underscore. This is
  // a single quantified class (linear), then cap the length.
  const collapsed = name.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, MAX_RENDER_TOOL_SLUG_CHARS);
  // Trim leading/trailing underscores with index walks rather than an anchored
  // `_+` regex — the latter is a polynomial-ReDoS vector on uncontrolled,
  // underscore-heavy names (CodeQL js/polynomial-redos).
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") {
    start += 1;
  }
  while (end > start && collapsed[end - 1] === "_") {
    end -= 1;
  }
  const slug = collapsed.slice(start, end);
  if (!slug) {
    return undefined;
  }
  return `${RENDER_TOOL_PREFIX}${slug}`;
}

/** A promoted component paired with the render-tool name it's exposed as. */
export interface PromotedRenderTool<T> {
  /** The dynamic MCP tool name, `render_<slug>`. */
  toolName: string;
  /** The component exposed by that tool. */
  component: T;
}

/**
 * Select the promoted components to expose as `render_<name>` tools, resolving
 * tool-name collisions deterministically (#1272). Components must be supplied in
 * the order the registry returns them (`updatedAt DESC`); the FIRST occurrence of
 * each tool name wins, so the most-recently-updated component owns the name.
 * Non-promoted components and names with no usable slug are skipped.
 *
 * Both the `tools/list` synthesis and the call dispatcher run this so the tool an
 * agent sees is exactly the tool it calls.
 */
export function selectPromotedRenderTools<T extends { name: string; promoted: boolean }>(
  components: readonly T[],
): PromotedRenderTool<T>[] {
  const selected: PromotedRenderTool<T>[] = [];
  const seen = new Set<string>();
  for (const component of components) {
    if (!component.promoted) {
      continue;
    }
    const toolName = componentRenderToolName(component.name);
    if (!toolName || seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    selected.push({ toolName, component });
  }
  return selected;
}
