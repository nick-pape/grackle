import type { Client } from "@connectrpc/connect";
import { type grackle, projectStatusToString } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for managing Grackle projects (CRUD + archive). */
export const projectTools: ToolDefinition[] = [
  {
    name: "project_list",
    group: "project",
    description:
      "List all Grackle projects with their names, descriptions, repositories, and status.",
    inputSchema: z.object({}),
    rpcMethod: "listProjects",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listProjects({});
        return jsonResult(
          response.projects.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            repoUrl: p.repoUrl,
            defaultEnvironmentId: p.defaultEnvironmentId,
            worktreeBasePath: p.worktreeBasePath,
            status: projectStatusToString(p.status) || "unspecified",
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "project_create",
    group: "project",
    description:
      "Create a new Grackle project with a name, optional description, repository URL, and default environment.",
    inputSchema: z.object({
      name: z.string().describe("Display name for the new project"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the project"),
      repoUrl: z
        .string()
        .optional()
        .describe("Optional repository URL associated with the project"),
      defaultEnvironmentId: z
        .string()
        .optional()
        .describe(
          "Optional ID of the default environment to use for this project",
        ),
      worktreeBasePath: z
        .string()
        .optional()
        .describe("Optional base path for worktrees (e.g. /workspaces/my-repo)"),
    }),
    rpcMethod: "createProject",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const project = await client.createProject({
          name: args.name as string,
          description: (args.description as string) ?? "",
          repoUrl: (args.repoUrl as string) ?? "",
          defaultEnvironmentId:
            (args.defaultEnvironmentId as string) ?? "",
          worktreeBasePath: (args.worktreeBasePath as string) ?? "",
        });
        return jsonResult({
          id: project.id,
          name: project.name,
          description: project.description,
          repoUrl: project.repoUrl,
          defaultEnvironmentId: project.defaultEnvironmentId,
          worktreeBasePath: project.worktreeBasePath,
          status: projectStatusToString(project.status) || "unspecified",
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "project_get",
    group: "project",
    description:
      "Get full details of a specific Grackle project by its unique identifier.",
    inputSchema: z.object({
      projectId: z.string().describe("Unique identifier of the project to retrieve"),
    }),
    rpcMethod: "getProject",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const project = await client.getProject({
          id: args.projectId as string,
        });
        return jsonResult({
          id: project.id,
          name: project.name,
          description: project.description,
          repoUrl: project.repoUrl,
          defaultEnvironmentId: project.defaultEnvironmentId,
          worktreeBasePath: project.worktreeBasePath,
          status: projectStatusToString(project.status) || "unspecified",
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "project_update",
    group: "project",
    description:
      "Update an existing Grackle project's name, description, repository URL, or default environment.",
    inputSchema: z.object({
      projectId: z.string().describe("Unique identifier of the project to update"),
      name: z
        .string()
        .optional()
        .describe("New display name for the project"),
      description: z
        .string()
        .optional()
        .describe("New description for the project"),
      repoUrl: z
        .string()
        .optional()
        .describe("New repository URL for the project"),
      defaultEnvironmentId: z
        .string()
        .optional()
        .describe("New default environment ID for the project"),
      worktreeBasePath: z
        .string()
        .optional()
        .describe("New base path for worktrees (e.g. /workspaces/my-repo)"),
    }),
    rpcMethod: "updateProject",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const project = await client.updateProject({
          id: args.projectId as string,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          repoUrl: args.repoUrl as string | undefined,
          defaultEnvironmentId: args.defaultEnvironmentId as
            | string
            | undefined,
          worktreeBasePath: args.worktreeBasePath as string | undefined,
        });
        return jsonResult({
          id: project.id,
          name: project.name,
          description: project.description,
          repoUrl: project.repoUrl,
          defaultEnvironmentId: project.defaultEnvironmentId,
          worktreeBasePath: project.worktreeBasePath,
          status: projectStatusToString(project.status) || "unspecified",
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "project_archive",
    group: "project",
    description:
      "Archive a Grackle project, marking it as inactive. This is a destructive operation.",
    inputSchema: z.object({
      projectId: z.string().describe("Unique identifier of the project to archive"),
    }),
    rpcMethod: "archiveProject",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        await client.archiveProject({
          id: args.projectId as string,
        });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
