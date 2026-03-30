import { vi } from "vitest";
export const createLifecycleSubscriber = vi.fn(() => ({ dispose: vi.fn() }));
export const cleanupLifecycleStream = vi.fn();
