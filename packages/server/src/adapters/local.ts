import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { createPowerLineClient } from "./powerline-transport.js";
import { sleep } from "../utils/sleep.js";

const POWERLINE_RETRY_DELAY_MS: number = 1_000;
const POWERLINE_MAX_RETRIES: number = 5;

/** Local-specific environment configuration. */
export interface LocalEnvironmentConfig extends BaseEnvironmentConfig {
  // No additional fields — local adapter only needs base config
}

/** Environment adapter that connects to a locally-running PowerLine process. */
export class LocalAdapter implements EnvironmentAdapter {
  public type: string = "local";

  public async *provision(environmentId: string, config: Record<string, unknown>, powerlineToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as LocalEnvironmentConfig;
    const port = cfg.port || DEFAULT_POWERLINE_PORT;
    const host = cfg.host || "localhost";

    yield { stage: "connecting", message: `Connecting to PowerLine at ${host}:${port}...`, progress: 0.5 };

    const client = createPowerLineClient(`http://${host}:${port}`, powerlineToken);

    let lastErr: unknown;
    for (let attempt = 0; attempt < POWERLINE_MAX_RETRIES; attempt++) {
      try {
        await client.ping({});
        yield { stage: "ready", message: "Connected to local PowerLine", progress: 1 };
        return;
      } catch (err) {
        lastErr = err;
        yield { stage: "connecting", message: `Waiting for PowerLine (attempt ${attempt + 1}/${POWERLINE_MAX_RETRIES})...`, progress: 0.5 + attempt * 0.1 };
        await sleep(POWERLINE_RETRY_DELAY_MS);
      }
    }

    yield { stage: "error", message: `Could not reach PowerLine: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, progress: 0 };
  }

  public async connect(environmentId: string, config: Record<string, unknown>, powerlineToken: string): Promise<PowerLineConnection> {
    const cfg = config as unknown as LocalEnvironmentConfig;
    const port = cfg.port || DEFAULT_POWERLINE_PORT;
    const host = cfg.host || "localhost";

    const client = createPowerLineClient(`http://${host}:${port}`, powerlineToken);
    await client.ping({});

    return { client, environmentId, port };
  }

  public async disconnect(): Promise<void> {
    // Nothing to clean up for local connections
  }

  public async stop(): Promise<void> {
    // Local PowerLine lifecycle is managed externally
  }

  public async destroy(): Promise<void> {
    // Local PowerLine lifecycle is managed externally
  }

  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    try {
      await connection.client.ping({});
      return true;
    } catch {
      return false;
    }
  }
}
