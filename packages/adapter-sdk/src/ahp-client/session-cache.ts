/**
 * Per-host cache of {@link SessionSummary} entries indexed by session URI.
 * Kept fresh by the {@link HostSupervisor}:
 *
 * - on every successful (re)connect, the supervisor calls `listSessions` and
 *   {@link replaceAll}s the cache with the result;
 * - between connects, the supervisor folds `root/sessionAdded`,
 *   `root/sessionRemoved`, and `root/sessionSummaryChanged` notifications
 *   into the cache via {@link add}, {@link remove}, and
 *   {@link applyChanges}.
 *
 * Matches the Rust SDK pattern documented in
 * `agent-host-protocol/clients/rust/MULTI_HOST.md`:
 *
 * > Session summaries are kept fresh by `listSessions` plus root session
 * > notifications.
 */

import type { SessionSummary, URI } from "@grackle-ai/ahp";

/** @internal */
export class SessionCache {
  private readonly summaries: Map<URI, SessionSummary> = new Map();

  /** Replace the cache wholesale (used after `listSessions` on every connect). */
  public replaceAll(items: readonly SessionSummary[]): void {
    this.summaries.clear();
    for (const summary of items) {
      this.summaries.set(summary.resource, summary);
    }
  }

  /** Insert (or overwrite) a single entry. */
  public add(uri: URI, summary: SessionSummary): void {
    this.summaries.set(uri, summary);
  }

  /** Remove an entry. No-op when missing. */
  public remove(uri: URI): void {
    this.summaries.delete(uri);
  }

  /**
   * Merge mutable summary fields into an existing entry. Identity fields
   * (`resource`, `provider`, `createdAt`) cannot change per the AHP spec
   * and are ignored if present in `changes`. No-op when `uri` is not
   * cached — matches the spec's guidance:
   *
   * > Clients that have no cached entry for `session` MAY ignore the
   * > notification.
   */
  public applyChanges(uri: URI, changes: Partial<SessionSummary>): void {
    const existing = this.summaries.get(uri);
    if (existing === undefined) {
      return;
    }
    this.summaries.set(uri, {
      ...existing,
      ...changes,
      // identity fields are immutable per AHP spec
      resource: existing.resource,
      provider: existing.provider,
      createdAt: existing.createdAt,
    });
  }

  /** Iterable of currently cached summaries. */
  public list(): SessionSummary[] {
    return [...this.summaries.values()];
  }

  /** Read a single entry by URI. */
  public get(uri: URI): SessionSummary | undefined {
    return this.summaries.get(uri);
  }

  /** Drop every entry. */
  public clear(): void {
    this.summaries.clear();
  }
}
