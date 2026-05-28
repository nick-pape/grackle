/**
 * Monotonic per-host generation counter. Bumped on every successful
 * (re)connect by {@link HostSupervisor}. Consumers that captured the
 * counter when pinning to a session can detect that their handle is
 * stale by comparing the current value.
 *
 * This mirrors the `generation` field on the Rust SDK's `HostHandle`
 * snapshot — see `agent-host-protocol/clients/rust/MULTI_HOST.md`.
 */
export class GenerationCounter {
  private value: number = 0;
  private readonly listeners: Set<(next: number) => void> = new Set();

  /** Current value. Starts at 0 before the first successful connect. */
  public current(): number {
    return this.value;
  }

  /** Increment and notify listeners. Returns the new value. */
  public bump(): number {
    this.value += 1;
    for (const listener of this.listeners) {
      listener(this.value);
    }
    return this.value;
  }

  /**
   * Register a listener fired with the new value on every {@link bump}.
   * Returns a function that removes the listener.
   */
  public onChange(listener: (next: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
