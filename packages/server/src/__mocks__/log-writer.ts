import { vi } from "vitest";
export const initLog = vi.fn();
export const ensureLogInitialized = vi.fn();
export const writeEvent = vi.fn();
export const endSession = vi.fn();
export const readLastTextEntry = vi.fn();
export const readLog = vi.fn(() => []);
