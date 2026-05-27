import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for Grackle environment management (list, add, provision, stop, destroy, remove, wake). */
export const envTools: ToolDefinition[] = [
  // ── env_list_docker_containers ───────────────────────────────────────────
  {
    name: "env_list_docker_containers",
    group: "env",
    description:
      "List running Docker containers that an environment can attach to (Docker adapter attach mode). " +
      "Use the returned container name with env_add (adapterType 'docker', adapterConfig.attach).",
    inputSchema: z.object({}),
    rpcMethod: "listDockerContainers",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const response = await client.listDockerContainers({});
        // Always return a single consistent shape: { containers, error }.
        return jsonResult({
          containers: response.containers.map((c) => ({
            id: c.id,
            name: c.name,
            image: c.image,
            state: c.state,
            status: c.status,
          })),
          error: response.error,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_list ─────────────────────────────────────────────────────────────
  {
    name: "env_list",
    group: "env",
    description:
      "List all registered Grackle environments with their status, adapter type, and default runtime.",
    inputSchema: z.object({}),
    rpcMethod: "listEnvironments",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const response = await client.listEnvironments({});
        return jsonResult(
          response.environments.map((e) => ({
            id: e.id,
            displayName: e.displayName,
            adapterType: e.adapterType,
            status: e.status,
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_add ──────────────────────────────────────────────────────────────
  {
    name: "env_add",
    group: "env",
    description:
      "Register a new environment with Grackle. Choose the adapter type that matches how the " +
      "environment is reached: 'local' (a PowerLine already running on this machine), 'ssh' (any " +
      "reachable host over SSH), 'codespace' (an existing GitHub Codespace), or 'docker' (spawn a " +
      "new container from an image, or set adapterConfig.attach to attach to an existing one — use " +
      "env_list_docker_containers to discover attachable containers). The required and optional " +
      "adapterConfig fields depend on the chosen adapterType, as described in this schema.",
    inputSchema: z.discriminatedUnion("adapterType", [
      // local — connect to a PowerLine already running on this machine
      z.object({
        displayName: z.string().describe("Human-readable name for the environment"),
        adapterType: z.literal("local"),
        adapterConfig: z
          .strictObject({
            host: z
              .string()
              .optional()
              .describe("Host the local PowerLine listens on (default 'localhost')"),
            port: z
              .number()
              .int()
              .min(1)
              .max(65535)
              .optional()
              .describe("PowerLine port (default 7433)"),
          })
          .optional()
          .describe("Optional local-adapter settings"),
      }),
      // ssh — connect to any reachable host over SSH (incl. a container exposing SSH)
      z.object({
        displayName: z.string().describe("Human-readable name for the environment"),
        adapterType: z.literal("ssh"),
        adapterConfig: z
          .strictObject({
            host: z.string().describe("Required. SSH hostname or IP address of the target"),
            user: z.string().optional().describe("SSH username (defaults to the current OS user)"),
            sshPort: z
              .number()
              .int()
              .min(1)
              .max(65535)
              .optional()
              .describe("SSH port on the target (default 22)"),
            identityFile: z.string().optional().describe("Path to an SSH private key file"),
            sshOptions: z
              .record(z.string(), z.string())
              .optional()
              .describe("Extra SSH options as key/value pairs, passed as -o Key=Value"),
            localPort: z
              .number()
              .int()
              .min(1)
              .max(65535)
              .optional()
              .describe("Override the local tunnel port (auto-assigned if omitted)"),
            env: z
              .record(z.string(), z.string())
              .optional()
              .describe("Environment variables forwarded to the remote PowerLine"),
          })
          .describe("SSH-adapter settings; 'host' is required"),
      }),
      // codespace — connect to an existing GitHub Codespace
      z.object({
        displayName: z.string().describe("Human-readable name for the environment"),
        adapterType: z.literal("codespace"),
        adapterConfig: z
          .strictObject({
            codespaceName: z.string().describe("Required. Codespace name from `gh codespace list`"),
            localPort: z
              .number()
              .int()
              .min(1)
              .max(65535)
              .optional()
              .describe("Override the local tunnel port (auto-assigned if omitted)"),
            env: z
              .record(z.string(), z.string())
              .optional()
              .describe("Environment variables forwarded to the remote PowerLine"),
          })
          .describe("Codespace-adapter settings; 'codespaceName' is required"),
        githubAccountId: z
          .string()
          .optional()
          .describe(
            "ID of a stored GitHub account used to authenticate `gh` (from the GitHub accounts list)",
          ),
      }),
      // docker — spawn a new container from an image
      z.object({
        displayName: z.string().describe("Human-readable name for the environment"),
        adapterType: z.literal("docker"),
        adapterConfig: z
          .strictObject({
            attach: z
              .string()
              .optional()
              .describe(
                "Attach to an existing container by name/ID instead of creating one. " +
                  "When set, Grackle never creates/stops/removes the container, and image/repo/volumes are ignored.",
              ),
            image: z
              .string()
              .optional()
              .describe("Docker image to run (default 'grackle-powerline:latest')"),
            containerName: z
              .string()
              .optional()
              .describe("Container name (default 'grackle-{environmentId}')"),
            repo: z
              .string()
              .optional()
              .describe("Git repo to clone into the container ('owner/repo' or full HTTPS URL)"),
            volumes: z
              .array(z.string())
              .optional()
              .describe("Docker volume mounts, e.g. ['/host/path:/container/path']"),
            gpus: z
              .string()
              .optional()
              .describe("GPU passthrough, e.g. 'all' for `docker run --gpus all`"),
            localPort: z
              .number()
              .int()
              .min(1)
              .max(65535)
              .optional()
              .describe("Override the published host port (auto-assigned if omitted)"),
            env: z
              .record(z.string(), z.string())
              .optional()
              .describe("Environment variables injected into the container"),
          })
          .optional()
          .describe("Optional docker-adapter settings"),
        githubAccountId: z
          .string()
          .optional()
          .describe(
            "ID of a stored GitHub account used to authenticate `gh` for private repo clones",
          ),
      }),
    ]),
    rpcMethod: "addEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const parsed = args as {
          displayName: string;
          adapterType: string;
          adapterConfig?: Record<string, unknown>;
          githubAccountId?: string;
        };
        const response = await client.addEnvironment({
          displayName: parsed.displayName,
          adapterType: parsed.adapterType,
          // Always send a valid JSON object string. The server stores this verbatim and
          // later runs JSON.parse on it at provision time, which would throw on "" — so
          // omitted config must serialize to "{}", not an empty string.
          adapterConfig: JSON.stringify(parsed.adapterConfig ?? {}),
          githubAccountId: parsed.githubAccountId ?? "",
        });
        return jsonResult(response);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_provision ────────────────────────────────────────────────────────
  {
    name: "env_provision",
    group: "env",
    description:
      "Provision an environment — start its backing resources, install the PowerLine agent, and connect it to the server.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to provision"),
      force: z.boolean().optional().describe("Force full reprovision, killing active sessions"),
    }),
    rpcMethod: "provisionEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      const { environmentId, force } = args as { environmentId: string; force?: boolean };
      const events: { stage: string; message: string; progress: number }[] = [];
      try {
        for await (const event of client.provisionEnvironment({
          id: environmentId,
          force: force ?? false,
        })) {
          events.push({
            stage: event.stage,
            message: event.message,
            progress: event.progress,
          });
        }
        return jsonResult({ events, finalStatus: "success" });
      } catch (error) {
        try {
          return grpcErrorToToolResult(error);
        } catch {
          // grpcErrorToToolResult re-throws non-ConnectError; wrap with collected events
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    events,
                    finalStatus: "error",
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }
    },
  },

  // ── env_stop ─────────────────────────────────────────────────────────────
  {
    name: "env_stop",
    group: "env",
    description:
      "Stop a running environment without destroying its backing resources. It can be woken later.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to stop"),
    }),
    rpcMethod: "stopEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.stopEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_destroy ──────────────────────────────────────────────────────────
  {
    name: "env_destroy",
    group: "env",
    description:
      "Destroy an environment's backing resources (e.g. delete the codespace or VM). The environment registration is kept.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to destroy"),
    }),
    rpcMethod: "destroyEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.destroyEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_remove ───────────────────────────────────────────────────────────
  {
    name: "env_remove",
    group: "env",
    description:
      "Remove an environment registration from Grackle. The environment must be stopped first.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to remove"),
    }),
    rpcMethod: "removeEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.removeEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_wake ─────────────────────────────────────────────────────────────
  {
    name: "env_wake",
    group: "env",
    description:
      "Wake a stopped environment by re-provisioning it. This starts its backing resources and reconnects the PowerLine agent.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the stopped environment to wake"),
    }),
    rpcMethod: "provisionEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      const { environmentId } = args as { environmentId: string };
      const events: { stage: string; message: string; progress: number }[] = [];
      try {
        for await (const event of client.provisionEnvironment({
          id: environmentId,
        })) {
          events.push({
            stage: event.stage,
            message: event.message,
            progress: event.progress,
          });
        }
        return jsonResult({ events, finalStatus: "success" });
      } catch (error) {
        try {
          return grpcErrorToToolResult(error);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    events,
                    finalStatus: "error",
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }
    },
  },
];
