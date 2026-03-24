import { vi } from "vitest";
export const registerAdapter = vi.fn();
export const getAdapter = vi.fn();
export const setConnection = vi.fn();
export const getConnection = vi.fn(() => undefined);
export const removeConnection = vi.fn();
export const listConnections = vi.fn(() => []);
export const startHeartbeat = vi.fn();
export const stopHeartbeat = vi.fn();
