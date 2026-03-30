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

export type { DomainHook } from "@grackle-ai/web-components";
