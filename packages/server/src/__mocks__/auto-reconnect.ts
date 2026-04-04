import { vi } from "vitest";
export const attemptReconnects = vi.fn();
export const clearReconnectState = vi.fn();
export const resetReconnectState = vi.fn();
export const isReconnecting = vi.fn().mockReturnValue(false);
export const _resetForTesting = vi.fn();
