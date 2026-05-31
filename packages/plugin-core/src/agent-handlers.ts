/**
 * Agent management RPC handlers.
 *
 * Phase 0 (#1417): the Agent is a minimal, dead context-axis entity — no
 * lifecycle, heartbeat, or autonomous spawning. These handlers are plain CRUD.
 * Each function is named to match its `GrackleOrchestration` RPC method so the
 * {@link ServiceCollector} can wire it automatically.
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { agentStore, envRegistry, sessionStore, taskStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { slugify } from "@grackle-ai/database";
import { emit } from "@grackle-ai/core";
import { agentRowToProto } from "./grpc-proto-converters.js";
import { killSessionAndCleanup } from "./grpc-shared.js";

/** List all agents. */
export async function listAgents(): Promise<grackle.AgentList> {
  const rows = agentStore.listAgents();
  return create(grackle.AgentListSchema, {
    agents: rows.map(agentRowToProto),
  });
}

/** Create a new agent. */
export async function createAgent(req: grackle.CreateAgentRequest): Promise<grackle.Agent> {
  const name = req.name.trim();
  if (!name) {
    throw new ConnectError("Agent name is required", Code.InvalidArgument);
  }
  if (agentStore.getAgentByName(name)) {
    throw new ConnectError(`Agent with name "${name}" already exists`, Code.AlreadyExists);
  }

  // The Agent's home environment is required (#1418): an Agent without an
  // environment can't be the principal for autonomous work since the runtime
  // needs a place to live. Validation: non-empty + environment exists.
  const environmentId = req.environmentId.trim();
  if (!environmentId) {
    throw new ConnectError("Agent environment_id is required", Code.InvalidArgument);
  }
  if (!envRegistry.getEnvironment(environmentId)) {
    throw new ConnectError(`Environment not found: ${environmentId}`, Code.NotFound);
  }

  // Enforce a unique ID derived from the name (mirrors persona handling).
  let id = slugify(name) || uuid().slice(0, 8);
  if (agentStore.getAgent(id)) {
    id = `${id}-${uuid().slice(0, 4)}`;
  }

  // Trim `avatar` and `primaryPersonaId` so whitespace-only input (e.g. "   ")
  // is stored as the empty string — keeps the UI's "no avatar" path working
  // (otherwise a string of spaces is truthy and skips the monogram fallback)
  // and prevents " https://..." style values from breaking the isImageAvatar
  // prefix check downstream.
  agentStore.createAgent(id, name, req.avatar.trim(), req.primaryPersonaId.trim(), environmentId);
  emit("agent.created", { agentId: id, environmentId });
  const row = agentStore.getAgent(id);
  return agentRowToProto(row!);
}

/** Get an agent by ID. */
export async function getAgent(req: grackle.AgentId): Promise<grackle.Agent> {
  const row = agentStore.getAgent(req.id);
  if (!row) {
    throw new ConnectError(`Agent not found: ${req.id}`, Code.NotFound);
  }
  return agentRowToProto(row);
}

/** Update an existing agent. Optional fields left unset preserve the stored value. */
export async function updateAgent(req: grackle.UpdateAgentRequest): Promise<grackle.Agent> {
  const existing = agentStore.getAgent(req.id);
  if (!existing) {
    throw new ConnectError(`Agent not found: ${req.id}`, Code.NotFound);
  }

  if (req.name === undefined && req.avatar === undefined && req.primaryPersonaId === undefined) {
    throw new ConnectError("No updatable fields provided", Code.InvalidArgument);
  }

  // Optional (presence-tracked) fields: undefined = keep existing. When `name`
  // is explicitly sent, trim it and reject empty (the DB's NOT NULL constraint
  // allows empty strings, which would persist an invalid record).
  let trimmedName: string | undefined;
  if (req.name !== undefined) {
    trimmedName = req.name.trim();
    if (!trimmedName) {
      throw new ConnectError("Agent name cannot be empty", Code.InvalidArgument);
    }
    if (trimmedName !== existing.name && agentStore.getAgentByName(trimmedName)) {
      throw new ConnectError(`Agent with name "${trimmedName}" already exists`, Code.AlreadyExists);
    }
  }

  // Trim avatar / primaryPersonaId on the way through too (presence-tracked:
  // undefined = keep existing, "" or whitespace-only = clear).
  agentStore.updateAgent(req.id, {
    name: trimmedName,
    avatar: req.avatar === undefined ? undefined : req.avatar.trim(),
    primaryPersonaId: req.primaryPersonaId === undefined ? undefined : req.primaryPersonaId.trim(),
  });
  emit("agent.updated", { agentId: req.id });
  const row = agentStore.getAgent(req.id);
  return agentRowToProto(row!);
}

/**
 * Delete an agent. Cascades through the Agent's task subtree (#1418):
 *
 * 1. Resolve the Agent's tasks (root + descendants — every task with this
 *    `agent_id`).
 * 2. Kill any non-terminal sessions attached to those tasks via
 *    {@link killSessionAndCleanup} so live runs don't keep ticking after
 *    the Agent disappears.
 * 3. Delete every task that belongs to the Agent.
 * 4. Delete the Agent row and emit `agent.deleted`.
 *
 * This is application-level cascade — the schema declares the FK but no
 * `ON DELETE CASCADE` (project convention; see `db.ts` migration comments).
 */
export async function deleteAgent(req: grackle.AgentId): Promise<grackle.Empty> {
  const agentTasks = taskStore.getTasksForAgent(req.id);
  for (const task of agentTasks) {
    for (const session of sessionStore.listSessionsForTask(task.id)) {
      killSessionAndCleanup(session);
    }
  }
  for (const task of agentTasks) {
    taskStore.deleteTask(task.id);
  }
  agentStore.deleteAgent(req.id);
  emit("agent.deleted", { agentId: req.id });
  return create(grackle.EmptySchema, {});
}
