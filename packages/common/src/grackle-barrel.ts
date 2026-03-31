/**
 * Barrel re-export that merges all per-plugin generated proto modules into a
 * single namespace. Consumers import via `grackle.*` from `@grackle-ai/common`
 * and access service descriptors as `grackle.GrackleCore`,
 * `grackle.GrackleOrchestration`, etc., and message types as `grackle.Task`,
 * `grackle.TaskSchema`, etc.
 *
 * @module
 */
export * from "./gen/grackle/grackle_types_pb.js";
export * from "./gen/grackle/grackle_core_pb.js";
export * from "./gen/grackle/grackle_orchestration_pb.js";
export * from "./gen/grackle/grackle_scheduling_pb.js";
export * from "./gen/grackle/grackle_knowledge_pb.js";
