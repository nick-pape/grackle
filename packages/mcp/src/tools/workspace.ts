import type { Client } from "@connectrpc/connect";
import { type grackle, workspaceStatusToString } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for managing Grackle workspaces (CRUD + archive). */
export const workspaceTools: ToolDefinition[] = [
  {
    name: "workspace_list",
    group: "workspace",
    description:
      "List all Grackle workspaces with their names, descriptions, repositories, worktree settings, and status.",
    inputSchema: z.object({}),
    rpcMethod: "listWorkspaces",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listWorkspaces({});
        return jsonResult(
          response.workspaces.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            repoUrl: p.repoUrl,
            defaultEnvironmentId: p.defaultEnvironmentId,
            worktreeBasePath: p.worktreeBasePath,
            useWorktrees: p.useWorktrees,
            status: workspaceStatusToString(p.status) || "unspecified",
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "workspace_create",
    group: "workspace",
    description:
      "Create a new Grackle workspace with a name, optional description, repository URL, and default environment.",
    inputSchema: z.object({
      name: z.string().describe("Display name for the new workspace"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the workspace"),
      repoUrl: z
        .string()
        .optional()
        .describe("Optional repository URL associated with the workspace"),
      defaultEnvironmentId: z
        .string()
        .optional()
        .describe(
          "Optional ID of the default environment to use for this workspace",
        ),
      worktreeBasePath: z
        .string()
        .optional()
        .describe("Optional base path for worktrees (e.g. /workspaces/my-repo)"),
      useWorktrees: z
        .boolean()
        .optional()
        .describe("Enable worktree isolation (defaults to true)"),
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for tasks in this workspace"),
    }),
    rpcMethod: "createWorkspace",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const workspace = await client.createWorkspace({
          name: args.name as string,
          description: (args.description as string | undefined) ?? "",
          repoUrl: (args.repoUrl as string | undefined) ?? "",
          defaultEnvironmentId:
            (args.defaultEnvironmentId as string | undefined) ?? "",
          worktreeBasePath: (args.worktreeBasePath as string | undefined) ?? "",
          useWorktrees: args.useWorktrees as boolean | undefined,
          defaultPersonaId: (args.defaultPersonaId as string | undefined) ?? "",
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          repoUrl: workspace.repoUrl,
          defaultEnvironmentId: workspace.defaultEnvironmentId,
          defaultPersonaId: workspace.defaultPersonaId,
          worktreeBasePath: workspace.worktreeBasePath,
          useWorktrees: workspace.useWorktrees,
          status: workspaceStatusToString(workspace.status) || "unspecified",
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "workspace_get",
    group: "workspace",
    description:
      "Get full details of a specific Grackle workspace by its unique identifier.",
    inputSchema: z.object({
      workspaceId: z.string().describe("Unique identifier of the workspace to retrieve"),
    }),
    rpcMethod: "getWorkspace",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const workspace = await client.getWorkspace({
          id: args.workspaceId as string,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          repoUrl: workspace.repoUrl,
          defaultEnvironmentId: workspace.defaultEnvironmentId,
          worktreeBasePath: workspace.worktreeBasePath,
          useWorktrees: workspace.useWorktrees,
          status: workspaceStatusToString(workspace.status) || "unspecified",
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "workspace_update",
    group: "workspace",
    description:
      "Update an existing Grackle workspace's name, description, repository URL, default environment, or worktree settings.",
    inputSchema: z.object({
      workspaceId: z.string().describe("Unique identifier of the workspace to update"),
      name: z
        .string()
        .optional()
        .describe("New display name for the workspace"),
      description: z
        .string()
        .optional()
        .describe("New description for the workspace"),
      repoUrl: z
        .string()
        .optional()
        .describe("New repository URL for the workspace"),
      defaultEnvironmentId: z
        .string()
        .optional()
        .describe("New default environment ID for the workspace"),
      worktreeBasePath: z
        .string()
        .optional()
        .describe("New base path for worktrees (e.g. /workspaces/my-repo)"),
      useWorktrees: z
        .boolean()
        .optional()
        .describe("Enable or disable worktree isolation"),
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for tasks in this workspace"),
    }),
    rpcMethod: "updateWorkspace",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const workspace = await client.updateWorkspace({
          id: args.workspaceId as string,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          repoUrl: args.repoUrl as string | undefined,
          defaultEnvironmentId: args.defaultEnvironmentId as
            | string
            | undefined,
          worktreeBasePath: args.worktreeBasePath as string | undefined,
          useWorktrees: args.useWorktrees as boolean | undefined,
          defaultPersonaId: args.defaultPersonaId as string | undefined,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          repoUrl: workspace.repoUrl,
          defaultEnvironmentId: workspace.defaultEnvironmentId,
          defaultPersonaId: workspace.defaultPersonaId,
          worktreeBasePath: workspace.worktreeBasePath,
          useWorktrees: workspace.useWorktrees,
          status: workspaceStatusToString(workspace.status) || "unspecified",
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "workspace_archive",
    group: "workspace",
    description:
      "Archive a Grackle workspace, marking it as inactive. This is a destructive operation.",
    inputSchema: z.object({
      workspaceId: z.string().describe("Unique identifier of the workspace to archive"),
    }),
    rpcMethod: "archiveWorkspace",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        await client.archiveWorkspace({
          id: args.workspaceId as string,
        });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
