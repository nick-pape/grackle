/**
 * Standard lifecycle interface for domain hooks.
 *
 * Every domain hook (useEnvironments, useSessions, etc.) must expose a
 * `domainHook` property conforming to this interface. The composition
 * hook ({@link useGrackleSocket}) collects `domainHook` instances from
 * its `domainHooks` array and iterates them for connect/disconnect/event
 * routing. To participate in this lifecycle, new hooks must be added to
 * that array.
 *
 * @module
 */

import type { GrackleEvent } from "@grackle-ai/web-components";

/** Lifecycle contract that every domain hook must implement. */
export interface DomainHook {
  /** Reload data when the ConnectRPC stream connects or reconnects. */
  onConnect(): Promise<void>;
  /** Reset transient state when the stream disconnects. */
  onDisconnect(): void;
  /** Handle a domain event. Return `true` if the event was consumed. */
  handleEvent(event: GrackleEvent): boolean;
}
