/**
 * Pass-through chunker that returns the entire input as a single chunk.
 *
 * Suitable for short content such as findings, decisions, and insights
 * that do not need to be split before embedding.
 *
 * @module
 */

import type { Chunker, Chunk } from "./chunker.js";

/**
 * Create a chunker that returns the input as a single chunk unchanged.
 *
 * @returns A {@link Chunker} that produces exactly one chunk per input.
 */
export function createPassThroughChunker(): Chunker {
  return {
    chunk(content: string, metadata?: Record<string, unknown>): Chunk[] {
      return [{ text: content, index: 0, metadata }];
    },
  };
}
