/**
 * Shared props interface for all tool card sub-components.
 *
 * The ToolCard router passes these through uniformly to whichever
 * specialized card component handles the tool category.
 */

/** Props accepted by every tool card sub-component. */
export interface ToolCardProps {
  /** Tool name as reported by the runtime (e.g. "Read", "view", "Bash"). */
  tool: string;
  /** Parsed args object from the tool_use event. */
  args: unknown;
  /** Tool result content string (undefined if still in-progress). */
  result?: string;
  /** Whether the tool result is an error. */
  isError?: boolean;
  /** Extended result content (e.g. Copilot's detailedContent with diffs). */
  detailedResult?: string;
  /**
   * For delegation tool calls (Agent/task/read_agent), the id of the
   * materialized child session this call spawned (#1075). When present, the
   * agent card links to the subagent's activity view. Undefined for
   * non-delegation tools.
   */
  childSessionId?: string;
}
