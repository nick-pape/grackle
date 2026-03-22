/**
 * Pluggable chunker interface for splitting content into embeddable pieces.
 *
 * @module
 */

/** A chunk of content produced by a {@link Chunker}. */
export interface Chunk {
  /** The text content of this chunk. */
  text: string;
  /** Zero-based index of this chunk within the source content. */
  index: number;
  /** Optional metadata carried through from the source or added by the chunker. */
  metadata?: Record<string, unknown>;
}

/** Splits content into chunks suitable for embedding. */
export interface Chunker {
  /** Split content into one or more chunks. */
  chunk(content: string, metadata?: Record<string, unknown>): Chunk[];
}
