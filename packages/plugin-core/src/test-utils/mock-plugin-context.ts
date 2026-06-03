/**
 * Shared mock factory for PluginContext used by subscriber test files.
 *
 * @module
 */

import { vi } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";

/** Stub logger that satisfies pino's Logger interface for type-checking. */
const MOCK_LOGGER: PluginContext["logger"] = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
} as unknown as PluginContext["logger"];

/** Minimal ServerConfig stub. */
const MOCK_CONFIG: PluginContext["config"] = {
  grpcPort: 0,
  webPort: 0,
  mcpPort: 0,
  powerlinePort: 0,
  host: "127.0.0.1",
  grackleHome: "/tmp/test",
  apiKey: "test-key",
};

/** Create a mock PluginContext with captured subscribe handler. */
export function createMockPluginContext(overrides?: Partial<PluginContext>): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn(),
    logger: { ...MOCK_LOGGER },
    config: { ...MOCK_CONFIG },
    ...overrides,
  };
}
