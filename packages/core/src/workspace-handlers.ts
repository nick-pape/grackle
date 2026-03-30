import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { workspaceStore, envRegistry, workspaceEnvironmentLinkStore, slugify } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";
import { workspaceRowToProto } from "./grpc-proto-converters.js";

/** List all workspaces, optionally filtered by environment. */
export async function listWorkspaces(req: grackle.ListWorkspacesRequest): Promise<grackle.WorkspaceList> {
  const rows = workspaceStore.listWorkspaces(req.environmentId || undefined);
  return create(grackle.WorkspaceListSchema, {
    workspaces: rows.map(workspaceRowToProto),
  });
}

/** Create a new workspace. */
export async function createWorkspace(req: grackle.CreateWorkspaceRequest): Promise<grackle.Workspace> {
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (!req.environmentId) {
    throw new ConnectError("environment_id is required", Code.InvalidArgument);
  }
  const env = envRegistry.getEnvironment(req.environmentId);
  if (!env) {
    throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
  }
  let id = slugify(req.name) || uuid().slice(0, 8);
  // If slug already exists (e.g. archived workspace), append a short suffix
  if (workspaceStore.getWorkspace(id)) {
    id = `${id}-${uuid().slice(0, 4)}`;
  }
  // useWorktrees defaults to true when not specified
  const useWorktrees = req.useWorktrees ?? true;
  workspaceStore.createWorkspace(
    id,
    req.name,
    req.description,
    req.repoUrl,
    req.environmentId,
    useWorktrees,
    req.workingDirectory ?? "",
    req.defaultPersonaId ?? "",
  );
  emit("workspace.created", { workspaceId: id });
  logger.info({ workspaceId: id }, "Workspace created");
  const row = workspaceStore.getWorkspace(id);
  return workspaceRowToProto(row!);
}

/** Get a workspace by ID. */
export async function getWorkspace(req: grackle.WorkspaceId): Promise<grackle.Workspace> {
  const row = workspaceStore.getWorkspace(req.id);
  if (!row) {
    throw new ConnectError(`Workspace not found: ${req.id}`, Code.NotFound);
  }
  return workspaceRowToProto(row);
}

/** Archive a workspace. */
export async function archiveWorkspace(req: grackle.WorkspaceId): Promise<grackle.Empty> {
  workspaceStore.archiveWorkspace(req.id);
  emit("workspace.archived", { workspaceId: req.id });
  logger.info({ workspaceId: req.id }, "Workspace archived");
  return create(grackle.EmptySchema, {});
}

/** Update workspace properties. */
export async function updateWorkspace(req: grackle.UpdateWorkspaceRequest): Promise<grackle.Workspace> {
  const existing = workspaceStore.getWorkspace(req.id);
  if (!existing) {
    throw new ConnectError(`Workspace not found: ${req.id}`, Code.NotFound);
  }
  if (req.name?.trim() === "") {
    throw new ConnectError("Workspace name cannot be empty", Code.InvalidArgument);
  }
  if (req.repoUrl !== undefined && req.repoUrl !== "" && !/^https?:\/\//i.test(req.repoUrl)) {
    throw new ConnectError("Repository URL must use http or https scheme", Code.InvalidArgument);
  }
  if (req.environmentId !== undefined) {
    const env = envRegistry.getEnvironment(req.environmentId);
    if (!env) {
      throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
    }
  }
  const row = workspaceStore.updateWorkspace(req.id, {
    name: req.name !== undefined ? req.name.trim() : undefined,
    description: req.description,
    repoUrl: req.repoUrl,
    environmentId: req.environmentId,
    useWorktrees: req.useWorktrees ?? undefined,
    workingDirectory: req.workingDirectory,
    defaultPersonaId: req.defaultPersonaId,
  });
  if (!row) {
    throw new ConnectError(`Workspace not found after update: ${req.id}`, Code.NotFound);
  }
  emit("workspace.updated", { workspaceId: req.id });
  return workspaceRowToProto(row);
}

/** Link an additional environment to a workspace's pool. */
export async function linkEnvironment(req: grackle.LinkEnvironmentRequest): Promise<grackle.Workspace> {
  const workspace = workspaceStore.getWorkspace(req.workspaceId);
  if (!workspace) {
    throw new ConnectError(`Workspace not found: ${req.workspaceId}`, Code.NotFound);
  }
  const env = envRegistry.getEnvironment(req.environmentId);
  if (!env) {
    throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
  }
  if (workspace.environmentId === req.environmentId) {
    throw new ConnectError(
      "Cannot link the primary environment — it is already in the pool",
      Code.InvalidArgument,
    );
  }
  if (workspaceEnvironmentLinkStore.isLinked(req.workspaceId, req.environmentId)) {
    throw new ConnectError(
      `Environment ${req.environmentId} is already linked to workspace ${req.workspaceId}`,
      Code.InvalidArgument,
    );
  }
  workspaceEnvironmentLinkStore.linkEnvironment(req.workspaceId, req.environmentId);
  emit("workspace.updated", { workspaceId: req.workspaceId });
  logger.info({ workspaceId: req.workspaceId, environmentId: req.environmentId }, "Environment linked to workspace");
  return workspaceRowToProto(workspace);
}

/** Remove a linked environment from a workspace's pool. */
export async function unlinkEnvironment(req: grackle.UnlinkEnvironmentRequest): Promise<grackle.Workspace> {
  const workspace = workspaceStore.getWorkspace(req.workspaceId);
  if (!workspace) {
    throw new ConnectError(`Workspace not found: ${req.workspaceId}`, Code.NotFound);
  }
  if (!workspaceEnvironmentLinkStore.isLinked(req.workspaceId, req.environmentId)) {
    throw new ConnectError(
      `Environment ${req.environmentId} is not linked to workspace ${req.workspaceId}`,
      Code.NotFound,
    );
  }
  workspaceEnvironmentLinkStore.unlinkEnvironment(req.workspaceId, req.environmentId);
  emit("workspace.updated", { workspaceId: req.workspaceId });
  logger.info({ workspaceId: req.workspaceId, environmentId: req.environmentId }, "Environment unlinked from workspace");
  return workspaceRowToProto(workspace);
}
