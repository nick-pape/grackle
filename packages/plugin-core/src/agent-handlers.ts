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
import { agentStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { slugify } from "@grackle-ai/database";
import { emit } from "@grackle-ai/core";
import { agentRowToProto } from "./grpc-proto-converters.js";

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

  // Enforce a unique ID derived from the name (mirrors persona handling).
  let id = slugify(name) || uuid().slice(0, 8);
  if (agentStore.getAgent(id)) {
    id = `${id}-${uuid().slice(0, 4)}`;
  }

  agentStore.createAgent(id, name, req.avatar, req.primaryPersonaId);
  emit("agent.created", { agentId: id });
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

  agentStore.updateAgent(req.id, {
    name: trimmedName,
    avatar: req.avatar,
    primaryPersonaId: req.primaryPersonaId,
  });
  emit("agent.updated", { agentId: req.id });
  const row = agentStore.getAgent(req.id);
  return agentRowToProto(row!);
}

/** Delete an agent by ID. */
export async function deleteAgent(req: grackle.AgentId): Promise<grackle.Empty> {
  agentStore.deleteAgent(req.id);
  emit("agent.deleted", { agentId: req.id });
  return create(grackle.EmptySchema, {});
}
