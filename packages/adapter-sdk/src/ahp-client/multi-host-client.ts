/**
 * `MultiHostClient` — Node port of the Rust SDK's multi-host facade
 * (`agent-host-protocol/clients/rust/MULTI_HOST.md`). Owns a set of
 * {@link HostSupervisor} instances keyed by `environmentId` and exposes a
 * single typed API for cross-host requests, subscriptions, and the
 * aggregated session view.
 *
 * Single-host = N=1 multi-host — there is no separate single-host facade.
 *
 * Built on `@grackle-ai/ahp-transport`'s `AhpClientSocket` (HR8a) and
 * `@grackle-ai/ahp`'s typed `CommandMap` (action types). HR8b ships
 * without consumer wiring — the package compiles and is fully tested but
 * nothing in `packages/core/` imports it yet. HR8c will migrate consumers.
 */

import type { CommandMap, URI } from "@grackle-ai/ahp";
import {
  type AhpConnectionState,
  type ClientIdStore,
  InMemoryClientIdStore,
} from "@grackle-ai/ahp-transport";

import {
  HostSupervisor,
  type HostSupervisorOptions,
  type SupervisorLogger,
} from "./host-supervisor.js";
import type {
  AddHostOptions,
  ClientDispatchableAction,
  HostedSessionSummary,
  SubscriptionMessage,
} from "./types.js";

/** Construction options for {@link MultiHostClient}. */
export interface MultiHostClientOptions {
  /** Optional logger; shared across every per-host supervisor. */
  readonly logger?: SupervisorLogger;
  /**
   * Factory that produces a `ClientIdStore` for each host. Defaults
   * to a fresh `InMemoryClientIdStore` per call — appropriate for tests
   * and ephemeral sessions. Production callers SHOULD supply a factory
   * that returns a `FileClientIdStore` (or equivalent) keyed by
   * `environmentId` so reconnect identity survives restarts.
   */
  readonly clientIdStoreFactory?: (environmentId: string) => ClientIdStore;
}

/**
 * Multi-host facade. Public API mirrors the Rust SDK shape but
 * surfaces the underlying `HostSupervisor` for advanced consumers (see
 * Rust's `HostClientHandle`).
 */
export class MultiHostClient {
  private readonly hosts: Map<string, HostSupervisor> = new Map();
  private readonly logger: SupervisorLogger | undefined;
  private readonly clientIdStoreFactory: (environmentId: string) => ClientIdStore;
  private isClosed: boolean = false;

  public constructor(opts: MultiHostClientOptions = {}) {
    this.logger = opts.logger;
    this.clientIdStoreFactory = opts.clientIdStoreFactory ?? (() => new InMemoryClientIdStore());
  }

  /**
   * Register a host and start connecting. Returns the per-host supervisor
   * synchronously; use {@link HostSupervisor.open}'s returned promise (or
   * `onStateChange()`) to await the initial connect if needed.
   *
   * Throws if `environmentId` is already registered or the client has been
   * closed.
   */
  public addHost(opts: AddHostOptions): HostSupervisor {
    if (this.isClosed) {
      throw new Error("MultiHostClient: addHost after close()");
    }
    if (this.hosts.has(opts.environmentId)) {
      throw new Error(`MultiHostClient: host '${opts.environmentId}' is already registered`);
    }
    const supervisorOpts: HostSupervisorOptions = {
      host: opts,
      clientIdStore: this.clientIdStoreFactory(opts.environmentId),
      ...(this.logger !== undefined ? { logger: this.logger } : {}),
    };
    const supervisor = new HostSupervisor(supervisorOpts);
    this.hosts.set(opts.environmentId, supervisor);
    // Fire-and-forget open; consumers needing to await the first connect
    // can call `supervisor.open()` themselves (the call is idempotent).
    void supervisor.open().catch((err: unknown) => {
      this.logger?.warn(
        { err, environmentId: opts.environmentId },
        "host failed to open; supervisor remains registered",
      );
    });
    return supervisor;
  }

  /**
   * Remove a host, close its supervisor, and free per-host resources.
   * Idempotent for unknown ids.
   */
  public async removeHost(environmentId: string): Promise<void> {
    const supervisor = this.hosts.get(environmentId);
    if (supervisor === undefined) {
      return;
    }
    this.hosts.delete(environmentId);
    await supervisor.close();
  }

  /** Typed request routed to the named host's supervisor. */
  public async request<M extends keyof CommandMap>(
    envId: string,
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]> {
    return this.requireHost(envId).request(method, params);
  }

  /** Subscribe to a channel on the named host. */
  public subscribe(
    envId: string,
    channel: URI,
    fromServerSeq?: number,
  ): AsyncIterable<SubscriptionMessage> {
    return this.requireHost(envId).subscribe(channel, fromServerSeq);
  }

  /** Send a client-dispatchable action to the named host. */
  public dispatchAction(envId: string, channel: URI, action: ClientDispatchableAction): void {
    this.requireHost(envId).dispatchAction(channel, action);
  }

  /**
   * Snapshot of every host's cached `SessionSummary` list, tagged with
   * `environmentId`. Wrapped in `Promise.resolve(...)` so the signature
   * stays open for future async sources (per the AHP project's own SDK
   * shape, though our current implementation reads cache synchronously).
   */
  public aggregatedSessions(): Promise<HostedSessionSummary[]> {
    if (this.isClosed) {
      return Promise.reject(new Error("MultiHostClient: called after close()"));
    }
    const all: HostedSessionSummary[] = [];
    for (const supervisor of this.hosts.values()) {
      all.push(...supervisor.hostedSessionSummaries());
    }
    return Promise.resolve(all);
  }

  /** Current connection state of the named host. Throws if unknown. */
  public getHostState(envId: string): AhpConnectionState {
    return this.requireHost(envId).state;
  }

  /** Register a state-change listener on the named host. Returns the unsubscribe. */
  public onStateChange(envId: string, listener: (state: AhpConnectionState) => void): () => void {
    return this.requireHost(envId).onStateChange(listener);
  }

  /** Current per-host generation counter. Throws if unknown. */
  public generation(envId: string): number {
    return this.requireHost(envId).generation();
  }

  /** Iterate over registered environment IDs (for diagnostics). */
  public environmentIds(): string[] {
    return [...this.hosts.keys()];
  }

  /** Access the per-host supervisor directly (Rust's `HostClientHandle`). */
  public host(envId: string): HostSupervisor | undefined {
    return this.hosts.get(envId);
  }

  /** Close every host's supervisor; subsequent calls reject. Idempotent. */
  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    const supervisors = [...this.hosts.values()];
    this.hosts.clear();
    await Promise.all(supervisors.map((s) => s.close()));
  }

  // ─── Internals ────────────────────────────────────────────────────

  private requireHost(envId: string): HostSupervisor {
    if (this.isClosed) {
      throw new Error("MultiHostClient: called after close()");
    }
    const supervisor = this.hosts.get(envId);
    if (supervisor === undefined) {
      throw new Error(`MultiHostClient: no host registered for environmentId '${envId}'`);
    }
    return supervisor;
  }
}
