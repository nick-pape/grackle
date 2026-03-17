/**
 * Re-exports from @grackle-ai/adapter-sdk.
 * All adapter types and the reconnectOrProvision helper are defined in the SDK;
 * this module preserves the import path for existing server code.
 */
import {
  reconnectOrProvision as sdkReconnectOrProvision,
  type EnvironmentAdapter,
  type ProvisionEvent,
  type AdapterLogger,
} from "@grackle-ai/adapter-sdk";
import { logger } from "../logger.js";

export type {
  EnvironmentAdapter,
  PowerLineConnection,
  ProvisionEvent,
  BaseEnvironmentConfig,
  PowerLineClient,
} from "@grackle-ai/adapter-sdk";

/**
 * Try fast reconnect if the adapter supports it and the environment was
 * previously bootstrapped, falling back to full provision on any error.
 * Injects the server's pino logger.
 */
export function reconnectOrProvision(
  environmentId: string,
  adapter: EnvironmentAdapter,
  config: Record<string, unknown>,
  powerlineToken: string,
  bootstrapped: boolean,
): AsyncGenerator<ProvisionEvent> {
  return sdkReconnectOrProvision(environmentId, adapter, config, powerlineToken, bootstrapped, logger as AdapterLogger);
}
