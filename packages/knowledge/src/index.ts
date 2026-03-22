/**
 * Grackle knowledge graph subsystem.
 *
 * Re-exports the generic {@link @grackle-ai/knowledge-core} SDK and adds
 * Grackle-specific reference node sync helpers for tasks and findings.
 *
 * @packageDocumentation
 */

// Re-export everything from the generic core
export * from "@grackle-ai/knowledge-core";

// Grackle-specific additions
export {
  findReferenceNodeBySource,
  deleteReferenceNodeBySource,
  syncReferenceNode,
  deriveTaskText,
  deriveFindingText,
} from "./reference-sync.js";
export type { SyncReferenceNodeInput } from "./reference-sync.js";
