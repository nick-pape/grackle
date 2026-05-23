/**
 * Reusable append-only, monotonically-sequenced log abstraction.
 *
 * This is the shared *mechanism* (not a shared store) underneath Grackle's
 * recurring "ordered, resumable log" problem — domain events, IPC stream
 * transcripts, and the eventual AHP conversation channel. Each domain supplies
 * its own {@link LogSink} (storage, retention, durability bar); the only thing
 * shared is the sequencing contract: a single authoritative writer per channel
 * tags every entry with a monotonic, lexicographically-sortable key.
 *
 * Phase 0 (RFC #1264) defines only the write path; the read / subscribe-from-
 * offset spine arrives with its first consumer in a later phase.
 *
 * @module
 */

/** A single entry in a {@link SequencedLog}, tagged with its monotonic sequence key. */
export interface Sequenced<T> {
  /**
   * Monotonic, lexicographically-sortable sequence key assigned at append time
   * (a ULID today). Ordering and replay are defined by ascending `seq`.
   */
  readonly seq: string;
  /** The domain payload carried by this entry. */
  readonly payload: T;
}

/**
 * Storage SPI for a {@link SequencedLog}. Each domain implements its own sink
 * (e.g. SQLite-backed, in-memory ring) so that storage, retention, and the
 * durability bar stay per-domain while the sequencing mechanism is shared.
 */
export interface LogSink<T> {
  /**
   * Durably append an entry to the given channel.
   *
   * @param channelId - The logical channel the entry belongs to.
   * @param entry - The sequenced entry to persist.
   */
  append(channelId: string, entry: Sequenced<T>): void;
}

/** Construction options for a {@link SequencedLog}. */
export interface SequencedLogOptions<T> {
  /** The storage sink entries are written to. */
  readonly sink: LogSink<T>;
  /** The logical channel this log instance writes to. */
  readonly channelId: string;
  /**
   * Generates the next monotonic, lexicographically-sortable sequence key.
   * Injected so the abstraction stays free of any particular key-generation
   * dependency (the consumer supplies, e.g., `ulid`).
   */
  readonly nextSeq: () => string;
}

/**
 * Append-only, monotonically-sequenced log over a pluggable {@link LogSink}.
 *
 * The single authoritative writer for a channel calls {@link SequencedLog.append};
 * each entry is tagged with a monotonic key from the injected `nextSeq` and
 * handed to the sink. Single-writer-per-channel is what makes the monotonic key
 * contention-free; consuming features that only observe must not write.
 */
export class SequencedLog<T> {
  private readonly sink: LogSink<T>;
  private readonly channelId: string;
  private readonly nextSeq: () => string;

  /** @param options - Sink, channel id, and sequence-key generator. */
  public constructor(options: SequencedLogOptions<T>) {
    this.sink = options.sink;
    this.channelId = options.channelId;
    this.nextSeq = options.nextSeq;
  }

  /**
   * Append a payload to the log: assign the next monotonic sequence key,
   * persist the entry via the sink, and return the sequenced entry.
   *
   * @param payload - The domain payload to append.
   * @returns The persisted entry, carrying its assigned `seq`.
   */
  public append(payload: T): Sequenced<T> {
    const entry: Sequenced<T> = { seq: this.nextSeq(), payload };
    this.sink.append(this.channelId, entry);
    return entry;
  }
}
