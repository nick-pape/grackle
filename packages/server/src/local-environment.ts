import { ROOT_TASK_ID, DEFAULT_WORKSPACE_ID } from "@grackle-ai/common";
import type { EnvironmentStatus } from "@grackle-ai/common";
import type { EnvironmentAdapter, PowerLineConnection, ProvisionEvent } from "@grackle-ai/adapter-sdk";
import type {
  EnvironmentRow,
  envRegistry as envRegistryModule,
  taskStore as taskStoreModule,
  workspaceStore as workspaceStoreModule,
  workspaceEnvironmentLinkStore as workspaceEnvironmentLinkStoreModule,
} from "@grackle-ai/database";
import type { emit as emitFn } from "@grackle-ai/core";
import type { LocalPowerLineManager } from "./local-powerline-manager.js";

/** Result of the local environment bootstrap. */
export interface LocalEnvironmentResult {
  /** The PowerLine manager if startup succeeded, undefined otherwise. */
  powerLineManager?: LocalPowerLineManager;
}

/** Minimal logger interface for dependency injection. */
interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** Injected dependencies for the local environment bootstrap. */
export interface LocalEnvironmentDeps {
  /** Environment registry (database module namespace). */
  envRegistry: Pick<typeof envRegistryModule,
    "getEnvironment" | "updateAdapterConfig" | "addEnvironment" |
    "updateEnvironmentStatus" | "markBootstrapped" | "updateDefaultRuntime"
  >;
  settingsStore: {
    getSetting: (key: string) => string | undefined;
  };
  personaStore: {
    getPersona: (id: string) => { runtime: string } | undefined;
  };
  /** Workspace store (database module namespace). */
  workspaceStore: Pick<typeof workspaceStoreModule, "getWorkspace" | "createWorkspaceAndLink">;
  /** Workspace-environment link store (database module namespace). */
  workspaceEnvironmentLinkStore: Pick<typeof workspaceEnvironmentLinkStoreModule, "linkEnvironment" | "isLinked">;
  /** Task store (database module namespace). */
  taskStore: Pick<typeof taskStoreModule, "getTask" | "setTaskWorkspace">;
  getAdapter: (type: string) => EnvironmentAdapter | undefined;
  parseAdapterConfig: (raw: string) => Record<string, unknown>;
  setConnection: (envId: string, conn: PowerLineConnection) => void;
  pushToEnv: (envId: string, opts?: { excludeFileTokens: boolean }) => Promise<void>;
  reconnectOrProvision: (
    envId: string,
    adapter: EnvironmentAdapter,
    config: Record<string, unknown>,
    token: string,
    bootstrapped: boolean,
  ) => AsyncGenerator<ProvisionEvent>;
  emit: typeof emitFn;
  resetReconnectState: (envId: string) => void;
  logger: Logger;
  createPowerLineManager: (opts: {
    port: number;
    host: string;
    token: string;
    onStatusChange: (status: EnvironmentStatus) => void;
    onRestarted: () => void;
  }) => LocalPowerLineManager;
}

/** Options for bootstrapping the local environment. */
interface LocalEnvironmentOptions {
  /** Port the PowerLine should listen on. */
  powerlinePort: number;
  /** Host the PowerLine should bind to. */
  bindHost: string;
  /** Skip auto-starting the local PowerLine process. */
  skipLocalPowerline: boolean;
}

/**
 * Bootstrap the local environment: create/update the DB record, sync runtime
 * with the default persona, seed the default workspace, start the PowerLine
 * child process, provision, and connect.
 *
 * This is a non-fatal operation — if anything fails, the error is logged and
 * the server continues without a local environment (remote envs still work).
 *
 * @param options - Port, host, and skip flag.
 * @param deps - Injected dependencies for testability.
 * @returns The PowerLine manager if startup succeeded.
 */
export async function bootstrapLocalEnvironment(
  options: LocalEnvironmentOptions,
  deps: LocalEnvironmentDeps,
): Promise<LocalEnvironmentResult> {
  const { powerlinePort, bindHost, skipLocalPowerline } = options;
  const { envRegistry, settingsStore, personaStore, workspaceStore, workspaceEnvironmentLinkStore, taskStore, logger } = deps;

  if (skipLocalPowerline) {
    logger.info("Skipping local PowerLine auto-start (GRACKLE_SKIP_LOCAL_POWERLINE=1)");
    return {};
  }

  let manager: LocalPowerLineManager | undefined;

  try {
    // Ensure the "local" environment exists in the database
    let localEnv: EnvironmentRow;
    const adapterConfig = JSON.stringify({ port: powerlinePort, host: bindHost });

    const existing = envRegistry.getEnvironment("local");
    if (existing) {
      // Update the adapter config to match the current port/host
      envRegistry.updateAdapterConfig("local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    } else {
      envRegistry.addEnvironment("local", "Local", "local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    }

    // Sync: keep the local environment's defaultRuntime in sync with the
    // app-level default persona's runtime so bootstrap pre-installs the
    // correct runtime packages (fixes #1031).
    const defaultPersonaId = settingsStore.getSetting("default_persona_id") || "";
    const defaultPersona = defaultPersonaId ? personaStore.getPersona(defaultPersonaId) : undefined;
    if (defaultPersona?.runtime && localEnv.defaultRuntime !== defaultPersona.runtime) {
      const previousRuntime = localEnv.defaultRuntime;
      envRegistry.updateDefaultRuntime("local", defaultPersona.runtime);
      localEnv = envRegistry.getEnvironment("local")!;
      logger.info(
        { from: previousRuntime, to: defaultPersona.runtime },
        "Synced local environment defaultRuntime with default persona",
      );
    }

    // Seed: ensure the default workspace exists (tied to the local environment).
    const defaultWorkspace = workspaceStore.getWorkspace(DEFAULT_WORKSPACE_ID);
    if (!defaultWorkspace) {
      workspaceStore.createWorkspaceAndLink(DEFAULT_WORKSPACE_ID, "Default", "", "", false, "", "", 0, 0, "local");
      logger.info("Created default workspace for local environment");
    } else if (!workspaceEnvironmentLinkStore.isLinked(DEFAULT_WORKSPACE_ID, "local")) {
      logger.warn(
        { workspaceId: DEFAULT_WORKSPACE_ID },
        "Default workspace is not linked to local environment; skipping system task association",
      );
    }

    // Backfill: assign the default workspace to the system task if it has none.
    const systemTask = taskStore.getTask(ROOT_TASK_ID);
    if (systemTask && !systemTask.workspaceId && workspaceEnvironmentLinkStore.isLinked(DEFAULT_WORKSPACE_ID, "local")) {
      taskStore.setTaskWorkspace(ROOT_TASK_ID, DEFAULT_WORKSPACE_ID);
      logger.info("Assigned default workspace to system task");
    }

    // Spawn the PowerLine child process with auto-restart on crash
    manager = deps.createPowerLineManager({
      port: powerlinePort,
      host: bindHost,
      token: localEnv.powerlineToken,
      onStatusChange: (status: EnvironmentStatus) => {
        envRegistry.updateEnvironmentStatus("local", status);
        deps.emit("environment.changed", {});
      },
      onRestarted: () => {
        deps.resetReconnectState("local");
      },
    });
    await manager.start();

    // Auto-provision: connect the local adapter
    const localAdapter = deps.getAdapter("local")!;
    const config = deps.parseAdapterConfig(localEnv.adapterConfig);

    envRegistry.updateEnvironmentStatus("local", "connecting");
    deps.emit("environment.changed", {});

    for await (const event of deps.reconnectOrProvision(
      "local",
      localAdapter,
      config,
      localEnv.powerlineToken,
      !!localEnv.bootstrapped,
    )) {
      logger.info({ stage: event.stage, progress: event.progress }, "Local env: %s", event.message);
    }

    const conn = await localAdapter.connect("local", config, localEnv.powerlineToken);
    deps.setConnection("local", conn);
    // Push env-var tokens only — file tokens would just overwrite local credential
    // files (e.g. ~/.claude/credentials.json) with their own content.
    await deps.pushToEnv("local", { excludeFileTokens: true });
    envRegistry.updateEnvironmentStatus("local", "connected");
    envRegistry.markBootstrapped("local");
    deps.emit("environment.changed", {});

    logger.info({ port: powerlinePort }, "Local environment auto-connected");

    return { powerLineManager: manager };
  } catch (err) {
    // Clean up the PowerLine child if it started but provisioning/connection failed
    if (manager) {
      try {
        await manager.stop();
      } catch (stopErr) {
        logger.warn(
          { err: stopErr, port: powerlinePort },
          "Failed to stop local PowerLine during cleanup",
        );
      }
    }
    envRegistry.updateEnvironmentStatus("local", "error");
    deps.emit("environment.changed", {});

    logger.error(
      { err, port: powerlinePort },
      "Failed to start local PowerLine — local environment will not be available. Is port %d in use?",
      powerlinePort,
    );
    // Non-fatal: server continues without local env (remote envs still work)
    return {};
  }
}
