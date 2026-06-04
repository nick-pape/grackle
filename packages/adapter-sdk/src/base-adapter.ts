import type { EnvironmentAdapter, PowerLineConnection, ProvisionEvent } from "./adapter.js";

/**
 * Lifecycle state for a single environment managed by an adapter.
 *
 * - `idle` — no active infrastructure or connection.
 * - `provisioning` — provision or reconnect in progress (mutex held).
 * - `provisioned` — infrastructure ready, not yet connected.
 * - `connected` — gRPC connection to PowerLine is established.
 */
export type AdapterLifecycleState = "idle" | "provisioning" | "provisioned" | "connected";

/**
 * Abstract base class for environment adapters that enforces lifecycle state
 * transitions and prevents concurrent operations on the same environment.
 *
 * Subclasses implement the `do*` template methods; {@link BaseAdapter} wraps
 * each with state guards and a per-environment mutex.
 *
 * The {@link EnvironmentAdapter} interface is unchanged — callers see the
 * same API. `reconnect` is NOT defined here because
 * {@link reconnectOrProvision} checks `adapter.reconnect` to decide whether
 * to attempt fast reconnect. Subclasses that support reconnect should define
 * their own `reconnect` method and use `withProvisionLock` for the
 * same mutex/state semantics as `provision`.
 */
export abstract class BaseAdapter implements EnvironmentAdapter {
  abstract type: string;

  private readonly states: Map<string, AdapterLifecycleState> = new Map<
    string,
    AdapterLifecycleState
  >();
  private readonly locks: Set<string> = new Set<string>();

  /** Return the lifecycle state for an environment (`idle` if unknown). */
  public getState(environmentId: string): AdapterLifecycleState {
    return this.states.get(environmentId) ?? "idle";
  }

  // ─── Guarded lifecycle methods ──────────────────────────────

  /**
   * Provision infrastructure and yield progress events.
   *
   * Acquires a per-environment mutex for the duration of provisioning.
   * On success the state moves to `provisioned`; on error it resets to `idle`.
   */
  public async *provision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    yield* this.withProvisionLock(
      environmentId,
      this.doProvision(environmentId, config, powerlineToken),
    );
  }

  /**
   * Establish a connection to the PowerLine.
   *
   * Allowed from any non-locked state. Docker attach calls this from `idle`
   * after a server restart (re-resolves connectivity on the fly).
   */
  public async connect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    this.assertNotLocked(environmentId);
    const conn = await this.doConnect(environmentId, config, powerlineToken);
    this.states.set(environmentId, "connected");
    return conn;
  }

  /** Release connection resources. Idempotent — safe to call from any state. */
  public async disconnect(environmentId: string): Promise<void> {
    await this.doDisconnect(environmentId);
    if (this.getState(environmentId) === "connected") {
      this.states.set(environmentId, "idle");
    }
  }

  /** Stop the environment's compute. Idempotent — resets state to `idle`. */
  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    await this.doStop(environmentId, config);
    this.states.set(environmentId, "idle");
  }

  /** Destroy the environment's compute. Idempotent — removes all state. */
  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    await this.doDestroy(environmentId, config);
    this.states.delete(environmentId);
  }

  /** Return true if the PowerLine is reachable. Subclasses must implement. */
  public abstract healthCheck(connection: PowerLineConnection): Promise<boolean>;

  // ─── Template methods for subclasses ────────────────────────

  protected abstract doProvision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent>;

  protected abstract doConnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection>;

  protected abstract doDisconnect(environmentId: string): Promise<void>;

  protected abstract doStop(environmentId: string, config: Record<string, unknown>): Promise<void>;

  protected abstract doDestroy(
    environmentId: string,
    config: Record<string, unknown>,
  ): Promise<void>;

  // ─── Lock helper for subclass reconnect ─────────────────────

  /**
   * Wrap an async generator (provision or reconnect) with the lifecycle mutex.
   *
   * Acquires a per-environment lock, sets state to `provisioning`, yields all
   * events from the wrapped generator, then sets state to `provisioned`.
   * On error the state resets to `idle`. Subclasses that support `reconnect`
   * should use this in their own `reconnect` method:
   *
   * ```ts
   * public async *reconnect(envId, config, token) {
   *   yield* this.withProvisionLock(envId, this.doReconnect(envId, config, token));
   * }
   * ```
   */
  protected async *withProvisionLock(
    environmentId: string,
    generator: AsyncGenerator<ProvisionEvent>,
  ): AsyncGenerator<ProvisionEvent> {
    this.assertNotLocked(environmentId);
    this.locks.add(environmentId);
    this.states.set(environmentId, "provisioning");
    try {
      yield* generator;
      this.states.set(environmentId, "provisioned");
    } catch (err) {
      this.states.set(environmentId, "idle");
      throw err;
    } finally {
      this.locks.delete(environmentId);
    }
  }

  // ─── Internals ──────────────────────────────────────────────

  private assertNotLocked(environmentId: string): void {
    if (this.locks.has(environmentId)) {
      throw new Error(
        `Operation already in progress for environment ${environmentId} (state: ${this.getState(environmentId)})`,
      );
    }
  }
}
