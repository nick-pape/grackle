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
    inputSchema: z.object({
      environmentId: z
        .string()
        .optional()
        .describe("Filter workspaces by environment ID (omit for all)"),
    }),
    rpcMethod: "listWorkspaces",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listWorkspaces({
          environmentId: (args.environmentId as string | undefined) ?? "",
        });
        return jsonResult(
          response.workspaces.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            repoUrl: p.repoUrl,
            environmentId: p.environmentId,
            linkedEnvironmentIds: p.linkedEnvironmentIds,
            workingDirectory: p.workingDirectory,
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
      environmentId: z
        .string()
        .describe("ID of the owning environment (required)"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the workspace"),
      repoUrl: z
        .string()
        .optional()
        .describe("Optional repository URL associated with the workspace"),
      workingDirectory: z
        .string()
        .optional()
        .describe("Working directory / repo root on the environment (e.g. /workspaces/my-repo)"),
      useWorktrees: z
        .boolean()
        .optional()
        .describe("Enable worktree isolation (defaults to true)"),
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for tasks in this workspace"),
      tokenBudget: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Token budget (input + output); 0 = unlimited"),
      costBudgetMillicents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Cost budget in millicents ($0.00001 units); 0 = unlimited"),
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
          environmentId: args.environmentId as string,
          workingDirectory: (args.workingDirectory as string | undefined) ?? "",
          useWorktrees: args.useWorktrees as boolean | undefined,
          defaultPersonaId: (args.defaultPersonaId as string | undefined) ?? "",
          tokenBudget: (args.tokenBudget as number | undefined) ?? 0,
          costBudgetMillicents: (args.costBudgetMillicents as number | undefined) ?? 0,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          repoUrl: workspace.repoUrl,
          environmentId: workspace.environmentId,
          linkedEnvironmentIds: workspace.linkedEnvironmentIds,
          defaultPersonaId: workspace.defaultPersonaId,
          workingDirectory: workspace.workingDirectory,
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
          environmentId: workspace.environmentId,
          linkedEnvironmentIds: workspace.linkedEnvironmentIds,
          workingDirectory: workspace.workingDirectory,
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
      "Update an existing Grackle workspace's name, description, repository URL, owning environment, or worktree settings.",
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
      environmentId: z
        .string()
        .optional()
        .describe("Reparent workspace to a different environment"),
      workingDirectory: z
        .string()
        .optional()
        .describe("New working directory / repo root (e.g. /workspaces/my-repo)"),
      useWorktrees: z
        .boolean()
        .optional()
        .describe("Enable or disable worktree isolation"),
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for tasks in this workspace"),
      tokenBudget: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Token budget (input + output); 0 = unlimited"),
      costBudgetMillicents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Cost budget in millicents ($0.00001 units); 0 = unlimited"),
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
          environmentId: args.environmentId as string | undefined,
          workingDirectory: args.workingDirectory as string | undefined,
          useWorktrees: args.useWorktrees as boolean | undefined,
          defaultPersonaId: args.defaultPersonaId as string | undefined,
          tokenBudget: args.tokenBudget as number | undefined,
          costBudgetMillicents: args.costBudgetMillicents as number | undefined,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          repoUrl: workspace.repoUrl,
          environmentId: workspace.environmentId,
          linkedEnvironmentIds: workspace.linkedEnvironmentIds,
          defaultPersonaId: workspace.defaultPersonaId,
          workingDirectory: workspace.workingDirectory,
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
  {
    name: "workspace_link_environment",
    group: "workspace",
    description:
      "Link an additional environment to a workspace, adding it to the workspace's environment pool for task dispatch.",
    inputSchema: z.object({
      workspaceId: z.string().describe("Workspace to link the environment to"),
      environmentId: z.string().describe("Environment to link"),
    }),
    rpcMethod: "linkEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const workspace = await client.linkEnvironment({
          workspaceId: args.workspaceId as string,
          environmentId: args.environmentId as string,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          environmentId: workspace.environmentId,
          linkedEnvironmentIds: workspace.linkedEnvironmentIds,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "workspace_unlink_environment",
    group: "workspace",
    description:
      "Remove a linked environment from a workspace's environment pool.",
    inputSchema: z.object({
      workspaceId: z.string().describe("Workspace to unlink the environment from"),
      environmentId: z.string().describe("Environment to unlink"),
    }),
    rpcMethod: "unlinkEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const workspace = await client.unlinkEnvironment({
          workspaceId: args.workspaceId as string,
          environmentId: args.environmentId as string,
        });
        return jsonResult({
          id: workspace.id,
          name: workspace.name,
          environmentId: workspace.environmentId,
          linkedEnvironmentIds: workspace.linkedEnvironmentIds,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
