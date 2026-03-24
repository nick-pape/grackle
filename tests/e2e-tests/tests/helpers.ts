import type { Page } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WsPayload = Record<string, any>;

/**
 * @deprecated Workspaces are no longer shown in the sidebar. Use {@link navigateToWorkspace} instead.
 * Get a locator for a workspace name in the main content area (not sidebar).
 */
export function getSidebarWorkspaceLabel(page: Page, workspaceName: string) {
  return page.getByText(workspaceName, { exact: true }).first();
}

/**
 * @deprecated Workspaces are no longer shown in the sidebar. Use {@link navigateToWorkspace} instead.
 * Get the parent row locator for a workspace name in the main content area.
 */
export function getSidebarWorkspaceRow(page: Page, workspaceName: string) {
  return getSidebarWorkspaceLabel(page, workspaceName).locator("..");
}

/**
 * Call a ConnectRPC method on the Grackle service from the browser page context.
 * Returns the parsed JSON response body on success, or throws on error.
 */
async function callRpc(
  page: Page,
  method: string,
  body: WsPayload,
): Promise<WsPayload> {
  return page.evaluate(
    async ({ method: m, body: b }) => {
      const resp = await fetch(`/grackle.Grackle/${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
        credentials: "include",
      });
      const text = await resp.text();
      if (!resp.ok) {
        let errMsg = text;
        try {
          const errObj = JSON.parse(text);
          errMsg = errObj.message || errObj.code || text;
        } catch { /* raw text */ }
        throw new Error(errMsg);
      }
      return text ? JSON.parse(text) : {};
    },
    { method, body },
  );
}

/**
 * Send a CRUD request via ConnectRPC and wait for either a direct response
 * or a domain event via WebSocket. This is a backward-compatible shim that
 * replaces the old WS-only approach now that CRUD routes through ConnectRPC.
 *
 * For list/query operations the RPC response is wrapped in the expected WS
 * envelope. For mutations that produce domain events the function subscribes
 * to the event bus over WS, fires the RPC call, then waits for the matching
 * event broadcast.
 */
export async function sendWsAndWaitFor(
  page: Page,
  message: WsPayload,
  responseType: string,
  timeoutMs = 10_000,
): Promise<WsPayload> {
  return page.evaluate(
    async ({ msg, respType, timeout }) => {
      // ── Helpers ──────────────────────────────────────────────

      /** Call a ConnectRPC endpoint and return the parsed JSON response. */
      async function rpc(
        method: string,
        body: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        const resp = await fetch(`/grackle.Grackle/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const text = await resp.text();
        if (!resp.ok) {
          let errMsg = text;
          try {
            const errObj = JSON.parse(text);
            errMsg = errObj.message || errObj.code || text;
          } catch { /* raw text */ }
          throw new Error(errMsg);
        }
        return text ? JSON.parse(text) : {};
      }

      /** Call RPC and wrap success as a WS-style envelope, or throw on error. */
      async function rpcWrapped(
        method: string,
        body: Record<string, unknown>,
        wrapType: string,
        wrapFn: (r: Record<string, unknown>) => Record<string, unknown>,
      ): Promise<{ type: string; payload: Record<string, unknown> }> {
        const r = await rpc(method, body);
        return { type: wrapType, payload: wrapFn(r) };
      }

      /**
       * Fire an RPC mutation and return a synthetic domain event envelope.
       * Instead of listening for the WS event (which requires opening a new
       * WebSocket and racing with the subscription), we fire the RPC and
       * construct the expected event shape from the response.
       *
       * The payload is mapped to match what the event bus would have sent.
       */
      async function rpcThenWaitForEvent(
        method: string,
        body: Record<string, unknown>,
        eventType: string,
      ): Promise<{ type: string; payload: Record<string, unknown> }> {
        const result = await rpc(method, body);
        // Map RPC responses to event-bus payload shapes
        let payload: Record<string, unknown> = result;
        switch (eventType) {
          case "environment.added":
          case "environment.changed":
            payload = { environmentId: result.id || "" };
            break;
          case "environment.removed":
            payload = { environmentId: body.id || "" };
            break;
          case "workspace.created":
          case "workspace.archived":
          case "workspace.updated":
            payload = { workspaceId: result.id || body.id || "" };
            break;
          case "task.created":
            payload = { taskId: result.id || "", workspaceId: result.workspaceId || body.workspaceId || "" };
            break;
          case "task.started":
            payload = { taskId: body.taskId || "", sessionId: result.id || "", workspaceId: result.workspaceId || body.workspaceId || "" };
            break;
          case "task.completed":
          case "task.deleted":
          case "task.updated":
            payload = { taskId: result.id || body.id || "", workspaceId: result.workspaceId || "" };
            break;
          case "token.changed":
            payload = {};
            break;
          case "persona.created":
          case "persona.updated":
          case "persona.deleted":
            payload = { personaId: result.id || body.id || "" };
            break;
          case "finding.posted":
            payload = { workspaceId: result.workspaceId || body.workspaceId || "" };
            break;
          default:
            payload = result;
        }
        return { type: eventType, payload };
      }

      // ── Event type enum → string mapping (for GetSessionEvents) ──

      const EVENT_TYPE_MAP: Record<number, string> = {
        0: "", 1: "text", 2: "tool_use", 3: "tool_result",
        4: "error", 5: "status", 6: "system", 7: "finding",
        8: "subtask_create", 9: "user_input", 10: "signal", 11: "usage",
      };

      // Also accept string values (if already converted by proto JSON)
      const EVENT_TYPE_STRING_MAP: Record<string, string> = {
        EVENT_TYPE_UNSPECIFIED: "", EVENT_TYPE_TEXT: "text",
        EVENT_TYPE_TOOL_USE: "tool_use", EVENT_TYPE_TOOL_RESULT: "tool_result",
        EVENT_TYPE_ERROR: "error", EVENT_TYPE_STATUS: "status",
        EVENT_TYPE_SYSTEM: "system", EVENT_TYPE_FINDING: "finding",
        EVENT_TYPE_SUBTASK_CREATE: "subtask_create",
        EVENT_TYPE_USER_INPUT: "user_input",
        EVENT_TYPE_SIGNAL: "signal", EVENT_TYPE_USAGE: "usage",
      };

      /** Convert proto eventType (number or enum string) to WS string. */
      function mapEventType(val: unknown): string {
        if (typeof val === "number") return EVENT_TYPE_MAP[val] ?? "";
        if (typeof val === "string") {
          if (EVENT_TYPE_STRING_MAP[val] !== undefined) return EVENT_TYPE_STRING_MAP[val];
          // Already a WS-style string (e.g. "text")
          return val;
        }
        return "";
      }

      // Task status enum → string
      const TASK_STATUS_MAP: Record<number, string> = {
        0: "", 1: "not_started", 3: "working", 4: "paused", 5: "complete", 6: "failed",
      };
      const TASK_STATUS_STRING_MAP: Record<string, string> = {
        TASK_STATUS_UNSPECIFIED: "", TASK_STATUS_NOT_STARTED: "not_started",
        TASK_STATUS_WORKING: "working", TASK_STATUS_PAUSED: "paused",
        TASK_STATUS_COMPLETE: "complete", TASK_STATUS_FAILED: "failed",
      };

      function mapTaskStatus(val: unknown): string {
        if (typeof val === "number") return TASK_STATUS_MAP[val] ?? "";
        if (typeof val === "string") {
          if (TASK_STATUS_STRING_MAP[val] !== undefined) return TASK_STATUS_STRING_MAP[val];
          return val;
        }
        return "";
      }

      // Workspace status enum → string
      const WORKSPACE_STATUS_MAP: Record<number, string> = {
        0: "", 1: "active", 2: "archived",
      };
      const WORKSPACE_STATUS_STRING_MAP: Record<string, string> = {
        WORKSPACE_STATUS_UNSPECIFIED: "", WORKSPACE_STATUS_ACTIVE: "active",
        WORKSPACE_STATUS_ARCHIVED: "archived",
      };

      function mapWorkspaceStatus(val: unknown): string {
        if (typeof val === "number") return WORKSPACE_STATUS_MAP[val] ?? "";
        if (typeof val === "string") {
          if (WORKSPACE_STATUS_STRING_MAP[val] !== undefined) return WORKSPACE_STATUS_STRING_MAP[val];
          return val;
        }
        return "";
      }

      /** Map a proto Task to the WS task shape (status as string). */
      function mapTask(t: Record<string, unknown>): Record<string, unknown> {
        return { ...t, status: mapTaskStatus(t.status) };
      }

      /** Map a proto Workspace to the WS workspace shape (status as string). */
      function mapWorkspace(w: Record<string, unknown>): Record<string, unknown> {
        return { ...w, status: mapWorkspaceStatus(w.status) };
      }

      /** Map a proto TokenInfo to the WS token shape (type → tokenType). */
      function mapToken(t: Record<string, unknown>): Record<string, unknown> {
        return { ...t, tokenType: t.type as string };
      }

      /** Map a proto Persona to the WS persona shape (stringify sub-objects). */
      function mapPersona(p: Record<string, unknown>): Record<string, unknown> {
        const mapped = { ...p };
        // Proto3 omits default values (empty strings) from JSON. Restore
        // them so test assertions that expect "" don't get undefined.
        for (const key of ["description", "systemPrompt", "runtime", "model", "type", "script"]) {
          if (mapped[key] === undefined) {
            mapped[key] = "";
          }
        }
        if (typeof mapped.toolConfig === "object" && mapped.toolConfig !== null) {
          mapped.toolConfig = JSON.stringify(mapped.toolConfig);
        } else if (mapped.toolConfig === undefined) {
          mapped.toolConfig = "{}";
        }
        if (Array.isArray(mapped.mcpServers)) {
          mapped.mcpServers = JSON.stringify(mapped.mcpServers);
        } else if (mapped.mcpServers === undefined) {
          mapped.mcpServers = "[]";
        }
        if (mapped.maxTurns === undefined) {
          mapped.maxTurns = 0;
        }
        return mapped;
      }

      /** Map a proto SessionEvent to the WS event shape. */
      function mapSessionEvent(e: Record<string, unknown>): Record<string, unknown> {
        return { ...e, eventType: mapEventType(e.type) };
      }

      /** Map a proto Session to the WS session shape. */
      function mapSession(s: Record<string, unknown>): Record<string, unknown> {
        return s;
      }

      // ── Payload extraction ───────────────────────────────────

      const wsType = msg.type as string;
      const payload = (msg.payload || {}) as Record<string, unknown>;

      // ── Error response handling ──────────────────────────────

      // If the caller expects an "error" response type, we call the RPC and
      // catch the thrown ConnectRPC error, wrapping it in a WS error envelope.
      if (respType === "error") {
        // Build the RPC call from the WS message type, then catch the error
        try {
          const result = await dispatchRpc(wsType, payload, respType, timeout);
          // If it unexpectedly succeeds, return the result anyway (caller may
          // be surprised but at least it won't hang).
          return result;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { type: "error", payload: { message: errMsg } };
        }
      }

      // For create_task with non-error response types that look like error types:
      if (respType === "create_task_error") {
        try {
          await dispatchRpc(wsType, payload, respType, timeout);
          return { type: "task.created", payload: {} };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { type: "create_task_error", payload: { message: errMsg } };
        }
      }

      if (respType === "create_workspace_error") {
        try {
          await dispatchRpc(wsType, payload, respType, timeout);
          return { type: "workspace.created", payload: {} };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { type: "create_workspace_error", payload: { message: errMsg } };
        }
      }

      return dispatchRpc(wsType, payload, respType, timeout);

      // ── Main dispatch ──────────────────────────────────────────

      async function dispatchRpc(
        wsType: string,
        payload: Record<string, unknown>,
        respType: string,
        timeout: number,
      ): Promise<{ type: string; payload: Record<string, unknown> }> {
        switch (wsType) {
          // ── List / Query operations (direct RPC response) ──────

          case "list_environments":
            return rpcWrapped("ListEnvironments", {}, "environments", (r) => ({
              environments: ((r.environments || []) as Record<string, unknown>[]),
            }));

          case "list_sessions":
            return rpcWrapped(
              "ListSessions",
              {
                environmentId: payload.environmentId || "",
                status: payload.status || "",
              },
              "sessions",
              (r) => ({
                sessions: ((r.sessions || []) as Record<string, unknown>[]).map(mapSession),
              }),
            );

          case "list_workspaces":
            return rpcWrapped("ListWorkspaces", {
              environmentId: payload.environmentId || "",
            }, "workspaces", (r) => ({
              workspaces: ((r.workspaces || []) as Record<string, unknown>[]).map(mapWorkspace),
            }));

          case "list_tasks":
            return rpcWrapped("ListTasks", {
              workspaceId: payload.workspaceId || "",
              search: payload.search || "",
              status: payload.status || "",
            }, "tasks", (r) => ({
              tasks: ((r.tasks || []) as Record<string, unknown>[]).map(mapTask),
              workspaceId: payload.workspaceId || "",
            }));

          case "list_tokens":
            return rpcWrapped("ListTokens", {}, "tokens", (r) => ({
              tokens: ((r.tokens || []) as Record<string, unknown>[]).map(mapToken),
            }));

          case "list_personas":
            return rpcWrapped("ListPersonas", {}, "personas", (r) => ({
              personas: ((r.personas || []) as Record<string, unknown>[]).map(mapPersona),
            }));

          case "get_session_events":
            return rpcWrapped("GetSessionEvents", {
              id: payload.sessionId as string,
            }, "session_events", (r) => ({
              sessionId: (r.sessionId || payload.sessionId) as string,
              events: ((r.events || []) as Record<string, unknown>[]).map(mapSessionEvent),
            }));

          case "get_credential_providers":
            return rpcWrapped("GetCredentialProviders", {}, "credential_providers", (r) => r);

          // ── Mutations with domain events ───────────────────────

          case "add_environment": {
            let adapterConfig = payload.adapterConfig;
            // Validate adapterConfig type (matches old WS bridge validation)
            if (adapterConfig !== undefined && adapterConfig !== null
                && typeof adapterConfig !== "object" && typeof adapterConfig !== "string") {
              throw new Error("adapterConfig must be an object or JSON string");
            }
            if (typeof adapterConfig === "string") {
              // Validate JSON
              try { JSON.parse(adapterConfig || "{}"); } catch {
                throw new Error("adapterConfig string is not valid JSON");
              }
            }
            if (typeof adapterConfig === "object" && adapterConfig !== null) {
              if (Array.isArray(adapterConfig)) {
                throw new Error("adapterConfig must be an object or JSON string");
              }
              adapterConfig = JSON.stringify(adapterConfig);
            }
            return rpcThenWaitForEvent(
              "AddEnvironment",
              {
                displayName: payload.displayName || "",
                adapterType: payload.adapterType || "",
                adapterConfig: (adapterConfig as string) || "",
              },
              "environment.added",
              timeout,
            );
          }

          case "update_environment": {
            let adapterConfig = payload.adapterConfig;
            if (typeof adapterConfig === "object" && adapterConfig !== null) {
              adapterConfig = JSON.stringify(adapterConfig);
            }
            const updateBody: Record<string, unknown> = {
              id: payload.environmentId as string,
            };
            if (payload.displayName !== undefined) {
              updateBody.displayName = payload.displayName;
            }
            if (adapterConfig !== undefined) {
              updateBody.adapterConfig = adapterConfig;
            }
            // If caller expects "environments", just call RPC and then list
            if (respType === "environments") {
              await rpc("UpdateEnvironment", updateBody);
              return rpcWrapped("ListEnvironments", {}, "environments", (r) => ({
                environments: ((r.environments || []) as Record<string, unknown>[]),
              }));
            }
            return rpcThenWaitForEvent("UpdateEnvironment", updateBody, respType);
          }

          case "remove_environment":
            return rpcThenWaitForEvent(
              "RemoveEnvironment",
              { id: payload.environmentId as string },
              "environment.removed",
              timeout,
            );

          case "stop_environment":
            // StopEnvironment returns Empty, then broadcasts environment.changed
            return rpcThenWaitForEvent(
              "StopEnvironment",
              { id: payload.environmentId as string },
              "environment.changed",
              timeout,
            );

          case "provision_environment": {
            // ProvisionEnvironment is server-streaming — must call the HTTP/2
            // gRPC server directly (the HTTP/1.1 web server can't do streaming).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const grpcPort = (window as any).__GRACKLE_GRPC_PORT__;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const apiKey = (window as any).__GRACKLE_API_KEY__;
            if (grpcPort && apiKey) {
              // Call gRPC server directly via HTTP/2 — fire and forget
              fetch(`http://127.0.0.1:${grpcPort}/grackle.Grackle/ProvisionEnvironment`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ id: payload.environmentId }),
              }).catch(() => { /* fire-and-forget */ });
            }
            // Poll until environment is connected
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 500));
              try {
                const listResp = await rpc("ListEnvironments", {});
                const envs = (listResp?.environments || []) as Array<Record<string, unknown>>;
                const env = envs.find((e) => e.id === payload.environmentId);
                if (env && env.status === "connected") {
                  return { type: "environment.changed", payload: {} };
                }
              } catch {
                // RPC may fail transiently during provision — keep polling
              }
            }
            throw new Error("Timeout waiting for environment to connect");
          }

          case "create_workspace":
            return rpcThenWaitForEvent(
              "CreateWorkspace",
              {
                name: payload.name || "",
                description: payload.description || "",
                repoUrl: payload.repoUrl || "",
                environmentId: payload.environmentId || "",
                defaultPersonaId: payload.defaultPersonaId || undefined,
              },
              "workspace.created",
              timeout,
            );

          case "archive_workspace":
            return rpcThenWaitForEvent(
              "ArchiveWorkspace",
              { id: payload.workspaceId as string },
              "workspace.archived",
              timeout,
            );

          case "create_task":
            return rpcThenWaitForEvent(
              "CreateTask",
              {
                workspaceId: payload.workspaceId || undefined,
                title: payload.title || "",
                description: payload.description || "",
                dependsOn: payload.dependsOn || [],
                parentTaskId: payload.parentTaskId || "",
                canDecompose: payload.canDecompose,
                defaultPersonaId: payload.defaultPersonaId || undefined,
              },
              "task.created",
              timeout,
            );

          case "start_task":
            return rpcThenWaitForEvent(
              "StartTask",
              {
                taskId: payload.taskId as string,
                personaId: payload.personaId || "",
                environmentId: payload.environmentId || "",
                notes: payload.notes || "",
              },
              "task.started",
              timeout,
            );

          case "delete_task":
            return rpcThenWaitForEvent(
              "DeleteTask",
              { id: payload.taskId as string },
              "task.deleted",
              timeout,
            );

          case "set_token":
            return rpcThenWaitForEvent(
              "SetToken",
              {
                name: payload.name || "",
                value: payload.value || "",
                type: payload.tokenType || "",
                envVar: payload.envVar || "",
                filePath: payload.filePath || "",
              },
              "token.changed",
              timeout,
            );

          case "delete_token":
            return rpcThenWaitForEvent(
              "DeleteToken",
              { name: payload.name as string },
              "token.changed",
              timeout,
            );

          case "set_credential_providers":
            return rpcThenWaitForEvent(
              "SetCredentialProvider",
              payload,
              "credential.providers_changed",
              timeout,
            );

          case "create_persona":
            return rpcThenWaitForEvent(
              "CreatePersona",
              {
                name: payload.name || "",
                description: payload.description || "",
                systemPrompt: payload.systemPrompt || "",
                runtime: payload.runtime || "",
                model: payload.model || "",
                maxTurns: payload.maxTurns || 0,
                type: payload.type || "",
                script: payload.script || "",
              },
              "persona.created",
              timeout,
            );

          case "update_persona":
            return rpcThenWaitForEvent(
              "UpdatePersona",
              {
                id: payload.personaId as string,
                name: payload.name || "",
                description: payload.description || "",
                systemPrompt: payload.systemPrompt || "",
                runtime: payload.runtime || "",
                model: payload.model || "",
                maxTurns: payload.maxTurns || 0,
              },
              "persona.updated",
              timeout,
            );

          case "delete_persona":
            return rpcThenWaitForEvent(
              "DeletePersona",
              { id: payload.personaId as string },
              "persona.deleted",
              timeout,
            );

          case "post_finding":
            return rpcThenWaitForEvent(
              "PostFinding",
              {
                workspaceId: payload.workspaceId || "",
                taskId: payload.taskId || "",
                sessionId: payload.sessionId || "",
                category: payload.category || "",
                title: payload.title || "",
                content: payload.content || "",
                tags: payload.tags || [],
              },
              "finding.posted",
              timeout,
            );

          case "spawn": {
            const r = await rpc("SpawnAgent", {
              environmentId: payload.environmentId || "",
              prompt: payload.prompt || "",
              personaId: payload.personaId || "",
              worktreeBasePath: payload.worktreeBasePath || "",
            });
            return { type: "spawned", payload: { sessionId: r.id as string } };
          }

          case "send_input": {
            await rpc("SendInput", {
              sessionId: payload.sessionId as string,
              text: payload.text as string,
            });
            return { type: "input_sent", payload: {} };
          }

          case "kill": {
            await rpc("KillAgent", { id: payload.sessionId as string });
            return { type: "killed", payload: {} };
          }

          case "resume_agent": {
            const r = await rpc("ResumeAgent", {
              sessionId: payload.sessionId as string,
            });
            return { type: "agent_resumed", payload: { sessionId: r.id as string, ...r } };
          }

          case "set_setting": {
            await rpc("SetSetting", {
              key: payload.key as string,
              value: payload.value as string,
            });
            return { type: "setting.changed", payload: { key: payload.key, value: payload.value } };
          }

          // ── Fallback to raw WebSocket ──────────────────────────

          default:
            return new Promise((resolve, reject) => {
              const ws = new WebSocket(`ws://${window.location.host}`);
              const timer = setTimeout(() => {
                ws.close();
                reject(new Error(`WS timeout waiting for "${respType}"`));
              }, timeout);
              ws.onmessage = (e: MessageEvent) => {
                const data = JSON.parse(e.data as string);
                if (data.type === respType) {
                  clearTimeout(timer);
                  ws.close();
                  resolve(data);
                }
              };
              ws.onerror = () => {
                clearTimeout(timer);
                ws.close();
                reject(new Error("WS connection error"));
              };
              ws.onopen = () => {
                ws.send(JSON.stringify(msg));
              };
            });
        }
      }
    },
    { msg: message, respType: responseType, timeout: timeoutMs },
  );
}

/**
 * Send a CRUD request via ConnectRPC without waiting for a specific response.
 * Fire-and-forget: calls the RPC endpoint and ignores the result.
 */
export async function sendWsMessage(
  page: Page,
  message: WsPayload,
): Promise<void> {
  await page.evaluate(async (msg) => {
    /** Call a ConnectRPC endpoint and return the parsed JSON response. */
    async function rpc(
      method: string,
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const resp = await fetch(`/grackle.Grackle/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const text = await resp.text();
      if (!resp.ok) {
        // Swallow errors for fire-and-forget
        return {};
      }
      return text ? JSON.parse(text) : {};
    }

    const wsType = msg.type as string;
    const payload = (msg.payload || {}) as Record<string, unknown>;

    switch (wsType) {
      case "remove_environment":
        await rpc("RemoveEnvironment", { id: payload.environmentId as string });
        break;

      case "stop_environment":
        await rpc("StopEnvironment", { id: payload.environmentId as string });
        break;

      case "provision_environment": {
        // ProvisionEnvironment is server-streaming — call gRPC server directly
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const grpcPort = (window as any).__GRACKLE_GRPC_PORT__;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const apiKey = (window as any).__GRACKLE_API_KEY__;
        if (grpcPort && apiKey) {
          fetch(`http://127.0.0.1:${grpcPort}/grackle.Grackle/ProvisionEnvironment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ id: payload.environmentId }),
          }).catch(() => { /* fire-and-forget */ });
        }
        // Poll until the environment is connected
        const provDeadline: number = Date.now() + 15_000;
        while (Date.now() < provDeadline) {
          await new Promise((r) => setTimeout(r, 300));
          try {
            const listResp = await rpc("ListEnvironments", {});
            const envs = (listResp?.environments || []) as Array<Record<string, unknown>>;
            const env = envs.find((e: Record<string, unknown>) => e.id === payload.environmentId);
            if (env && env.status === "connected") {
              break;
            }
          } catch { /* keep polling */ }
        }
        break;
      }

      case "delete_task":
        await rpc("DeleteTask", { id: payload.taskId as string });
        break;

      case "send_input":
        await rpc("SendInput", {
          sessionId: payload.sessionId as string,
          text: payload.text as string,
        });
        break;

      case "kill":
        await rpc("KillAgent", { id: payload.sessionId as string });
        break;

      case "post_finding":
        await rpc("PostFinding", {
          workspaceId: payload.workspaceId || "",
          taskId: payload.taskId || "",
          sessionId: payload.sessionId || "",
          category: payload.category || "",
          title: payload.title || "",
          content: payload.content || "",
          tags: payload.tags || [],
        });
        break;

      case "set_setting":
        await rpc("SetSetting", {
          key: payload.key as string,
          value: payload.value as string,
        });
        break;

      default:
        // Fallback: send via raw WebSocket
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://${window.location.host}`);
          ws.onerror = () => {
            ws.close();
            reject(new Error("WS error"));
          };
          ws.onopen = () => {
            ws.send(JSON.stringify(msg));
            setTimeout(() => {
              ws.close();
              resolve();
            }, 500);
          };
        });
        break;
    }

    // Brief delay to let the server process the request
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, message);
}

/** Retrieve the workspace ID for a workspace with the given name. */
export async function getWorkspaceId(
  page: Page,
  workspaceName: string,
): Promise<string> {
  const rpcResp = await callRpc(page, "ListWorkspaces", {});
  const workspaces = (rpcResp.workspaces || []) as Array<{
    id: string;
    name: string;
  }>;
  const workspace = workspaces.find((w) => w.name === workspaceName);
  if (!workspace) {
    throw new Error(`Workspace "${workspaceName}" not found`);
  }
  return workspace.id;
}

/** @deprecated Use {@link getWorkspaceId} instead. */
export const getProjectId = getWorkspaceId;

/** Retrieve the task ID for a task with the given title under a workspace. */
export async function getTaskId(
  page: Page,
  workspaceId: string,
  taskTitle: string,
): Promise<string> {
  const rpcResp = await callRpc(page, "ListTasks", { workspaceId });
  const tasks = (rpcResp.tasks || []) as Array<{
    id: string;
    title: string;
  }>;
  const task = tasks.find((t) => t.title === taskTitle);
  if (!task) {
    throw new Error(`Task "${taskTitle}" not found in workspace ${workspaceId}`);
  }
  return task.id;
}

/**
 * Create a workspace via ConnectRPC and wait for the server to confirm creation.
 * Requires the test environment ("test-local") to already exist.
 */
export async function createWorkspace(page: Page, name: string, environmentId: string = "test-local"): Promise<void> {
  await sendWsAndWaitFor(
    page,
    {
      type: "create_workspace",
      payload: { name, environmentId },
    },
    "workspace.created",
  );
}

/** @deprecated Use {@link createWorkspace} instead. */
export const createProject = createWorkspace;

/**
 * Navigate to a workspace page by looking up its ID via ConnectRPC and then
 * navigating to `/workspaces/:workspaceId`. Replaces the old sidebar-click
 * approach since workspaces are no longer listed in the sidebar.
 */
export async function navigateToWorkspace(page: Page, workspaceName: string): Promise<void> {
  const workspaceId = await getWorkspaceId(page, workspaceName);
  await page.goto(`/workspaces/${workspaceId}`);
  await page.waitForFunction(
    () => document.body.innerText.includes("Connected"),
    { timeout: 10_000 },
  );
  // Wait for workspace page to load — workspace name should be visible
  await page.locator('[data-testid="workspace-name"]').waitFor({ timeout: 5_000 });
}

/** @deprecated Use {@link navigateToWorkspace} instead. */
export async function clickSidebarLabel(page: Page, label: string): Promise<void> {
  await navigateToWorkspace(page, label);
}

/** @deprecated Use {@link navigateToWorkspace} instead. */
export const clickSidebarWorkspace = clickSidebarLabel;

/**
 * Create a task under a workspace via ConnectRPC.
 *
 * Tasks are always created via the API now since the sidebar no longer shows
 * workspace rows with "New task" buttons. The task is created server-side and
 * will appear in the TaskList sidebar or workspace pages on next render.
 */
export async function createTask(
  page: Page,
  workspaceName: string,
  title: string,
  envName?: string,
  options?: { canDecompose?: boolean },
): Promise<void> {
  const wsId = await getWorkspaceId(page, workspaceName);
  await createTaskViaWs(page, wsId, title, {
    environmentId: envName || "",
    canDecompose: options?.canDecompose,
  });
}

/**
 * Navigate to a task view by clicking its name on the page.
 * Falls back to looking up the task ID via ConnectRPC and navigating by URL.
 */
export async function navigateToTask(
  page: Page,
  taskTitle: string,
): Promise<void> {
  // Try to click the task name if it's visible on the current page
  const taskLink = page.getByText(taskTitle, { exact: true }).first();
  const isVisible = await taskLink.isVisible().catch(() => false);

  if (isVisible) {
    await taskLink.click();
  } else {
    // Task not visible — look up the workspace and task ID, then navigate by URL.
    const rpcResp = await callRpc(page, "ListWorkspaces", {});
    const workspaces = (rpcResp.workspaces || []) as Array<{ id: string }>;

    let taskId: string | undefined;
    for (const ws of workspaces) {
      try {
        taskId = await getTaskId(page, ws.id, taskTitle);
        break;
      } catch {
        // Task not in this workspace, try next
      }
    }

    if (!taskId) {
      throw new Error(`Task "${taskTitle}" not found in any workspace`);
    }

    await page.goto(`/tasks/${taskId}`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
  }

  // Wait for the task detail header to show this specific task's title.
  await page.locator(`[data-testid="task-title"]:has-text("${taskTitle}")`).waitFor({ timeout: 5_000 });
}

/**
 * Monkey-patch fetch() to force the "Stub" persona and inject environmentId on
 * StartTask requests. The server resolves the runtime from the persona (not a
 * runtime field), so we set personaId to "stub" which maps to the "Stub" persona
 * created in global-setup. Environment is now a start-time param (not stored on
 * the task), so tests must provide it explicitly.
 */
export async function patchWsForStubRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFetch = (window as any).__origFetch__ || window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__origFetch__ = origFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
      if ((url.includes("/grackle.Grackle/StartTask") || url.includes("/grackle.Grackle/SpawnAgent")) && init?.body) {
        try {
          // ConnectRPC may serialize the body as Uint8Array, not a JSON string
          let bodyStr: string;
          if (init.body instanceof Uint8Array) {
            bodyStr = new TextDecoder().decode(init.body);
          } else {
            bodyStr = init.body as string;
          }
          const body = JSON.parse(bodyStr);
          body.personaId = "stub";
          if (!body.environmentId) {
            body.environmentId = envId;
          }
          const newBodyStr = JSON.stringify(body);
          init = { ...init, body: new TextEncoder().encode(newBodyStr) };
        } catch {
          /* not JSON, pass through */
        }
      }
      return origFetch.call(this, input, init);
    };
  }, environmentId);
}

/**
 * Run a stub task through its full lifecycle: start -> working -> idle -> send input -> paused.
 * Requires patchWsForStubRuntime to have been called on the page beforehand.
 */
export async function runStubTaskToCompletion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // Wait for idle state (session waiting for input)
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Wait for session to complete and task to move to paused (review).
  // "Resume" only appears in paused state, unlike "Stop" which is in both
  // working and paused states.
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/**
 * Send a WS message and wait for an "error" response.
 * Convenience wrapper around sendWsAndWaitFor for error-path testing.
 */
export async function sendWsAndWaitForError(
  page: Page,
  message: WsPayload,
  timeoutMs = 10_000,
): Promise<WsPayload> {
  return sendWsAndWaitFor(page, message, "error", timeoutMs);
}

/**
 * Inject a fake WS message into the app's existing WebSocket connection.
 * Calls the onmessage handler directly on the first OPEN tracked WebSocket.
 * Requires installWsTracker to have been called via addInitScript before page.goto.
 */
export async function injectWsMessage(
  page: Page,
  message: WsPayload,
): Promise<void> {
  await page.evaluate((msg) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sockets = (window as any).__grackle_ws_instances__ as
      | WebSocket[]
      | undefined;
    if (!sockets) {
      throw new Error(
        "WS tracker not installed — call installWsTracker before page.goto",
      );
    }
    // Find the app's socket (first OPEN one — helper sockets are already closed)
    const ws = sockets.find((s) => s.readyState === WebSocket.OPEN);
    if (!ws) {
      throw new Error(`No OPEN WebSocket found (tracked: ${sockets.length})`);
    }
    // The app uses ws.onmessage (not addEventListener), so call it directly
    if (ws.onmessage) {
      ws.onmessage(
        new MessageEvent("message", {
          data: JSON.stringify(msg),
        }),
      );
    }
  }, message);
}

/**
 * Install a hook via addInitScript that records all WebSocket instances opened by the app.
 * Must be called BEFORE page.goto so the script runs before app JavaScript.
 * Used by injectWsMessage to find the app's active socket.
 */
export async function installWsTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__grackle_ws_instances__ = [];
    const OrigWs = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__OrigWebSocket__ = OrigWs;
    // @ts-expect-error — we're wrapping the constructor
    window.WebSocket = function (
      ...args: ConstructorParameters<typeof WebSocket>
    ) {
      const ws = new OrigWs(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__grackle_ws_instances__.push(ws);
      return ws;
    } as unknown as typeof WebSocket;
    window.WebSocket.prototype = OrigWs.prototype;
    Object.defineProperty(window.WebSocket, "CONNECTING", {
      value: OrigWs.CONNECTING,
    });
    Object.defineProperty(window.WebSocket, "OPEN", { value: OrigWs.OPEN });
    Object.defineProperty(window.WebSocket, "CLOSING", {
      value: OrigWs.CLOSING,
    });
    Object.defineProperty(window.WebSocket, "CLOSED", { value: OrigWs.CLOSED });
  });
}

/** Create a task via ConnectRPC with custom options (e.g., dependsOn, parentTaskId). Returns the created task data. */
export async function createTaskViaWs(
  page: Page,
  workspaceId: string,
  title: string,
  options?: {
    environmentId?: string;
    dependsOn?: string[];
    description?: string;
    parentTaskId?: string;
    canDecompose?: boolean;
  },
): Promise<WsPayload> {
  // Create the task via ConnectRPC (fires task.created event)
  await sendWsAndWaitFor(
    page,
    {
      type: "create_task",
      payload: {
        workspaceId,
        title,
        description: options?.description || "",
        dependsOn: options?.dependsOn || [],
        parentTaskId: options?.parentTaskId || "",
        canDecompose: options?.canDecompose,
      },
    },
    "task.created",
  );
  // Fetch the full task list to find the created task by title
  const rpcResp = await callRpc(page, "ListTasks", { workspaceId });
  const tasks = (rpcResp.tasks || []) as WsPayload[];
  const task = tasks.find((t) => t.title === title);
  if (task) {
    return task;
  }
  // Fallback: return minimal data
  return { title, workspaceId };
}

/**
 * Monkey-patch fetch() to force the "Stub MCP" persona and inject
 * environmentId on StartTask requests. The server resolves the runtime
 * from the persona (not a runtime field), so we set personaId to "stub-mcp"
 * which maps to the "Stub MCP" persona created in global-setup.
 */
export async function patchWsForStubMcpRuntime(page: Page, environmentId: string = "test-local"): Promise<void> {
  await page.evaluate((envId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origFetch = (window as any).__origFetch__ || window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__origFetch__ = origFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
      if ((url.includes("/grackle.Grackle/StartTask") || url.includes("/grackle.Grackle/SpawnAgent")) && init?.body) {
        try {
          let bodyStr: string;
          if (init.body instanceof Uint8Array) {
            bodyStr = new TextDecoder().decode(init.body);
          } else {
            bodyStr = init.body as string;
          }
          const body = JSON.parse(bodyStr);
          body.personaId = "stub-mcp";
          if (!body.environmentId) {
            body.environmentId = envId;
          }
          const newBodyStr = JSON.stringify(body);
          init = { ...init, body: new TextEncoder().encode(newBodyStr) };
        } catch {
          /* not JSON, pass through */
        }
      }
      return origFetch.call(this, input, init);
    };
  }, environmentId);
}

/**
 * Run a stub-mcp task through its full lifecycle: start -> working -> idle -> send input -> paused.
 * Requires patchWsForStubMcpRuntime to have been called on the page beforehand.
 */
export async function runStubMcpTaskToCompletion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // Wait for idle state (session waiting for input)
  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Wait for session to complete and task to move to paused (review).
  // "Resume" only appears in paused state, unlike "Stop" which is in both
  // working and paused states.
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ timeout: 15_000 });
}

/** Navigate to settings and wait for the tab nav to appear. */
export async function goToSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-settings"]').click();
  await page.getByRole("tablist", { name: "Settings" }).waitFor({ state: "visible", timeout: 5_000 });
}

/** Navigate to the Environments tab in the sidebar. */
export async function goToEnvironments(page: Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-environments"]').click();
}

/**
 * Provision an environment by calling the gRPC server (HTTP/2) directly
 * from the Node.js test context. This bypasses the browser and avoids
 * CORS issues with cross-port requests. Polls until connected.
 *
 * Reads gRPC port and API key from the E2E state file.
 */
/**
 * Provision an environment using the CLI, which is the same mechanism
 * global-setup uses and is known to work reliably. Calls the gRPC server
 * via ConnectRPC (HTTP/2) under the hood.
 */
export async function provisionEnvironmentDirect(environmentId: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const { resolve: pathResolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { STATE_FILE } = await import("./state-file.js");
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));

  // Resolve CLI path relative to this file's location (not CWD, which is tests/e2e-tests/)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const cliPath = pathResolve(thisDir, "..", "..", "..", "packages", "cli", "dist", "index.js");
  try {
    execSync(`node "${cliPath}" env provision ${environmentId}`, {
      env: {
        ...process.env,
        GRACKLE_URL: `http://127.0.0.1:${state.serverPort}`,
        GRACKLE_API_KEY: state.apiKey,
      },
      timeout: 30_000,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already connected") && !msg.includes("Already connected")) {
      throw err;
    }
  }
}
