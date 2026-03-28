import type { AgentEvent } from "./runtime.js";

/**
 * Drain events from an async iterator until a status event with the given content.
 *
 * Shared test utility used across all runtime test suites. Collects all events
 * up to and including the matching status event, or throws if the stream ends
 * before the expected status is found.
 */
export async function drainUntilStatus(
  nextEvent: () => Promise<AgentEvent | undefined>,
  statusContent: string,
): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop until match
  while (true) {
    const event = await nextEvent();
    if (!event) {
      throw new Error(`Stream ended before status "${statusContent}"`);
    }
    collected.push(event);
    if (event.type === "status" && event.content === statusContent) {
      return collected;
    }
  }
}
