import { vi } from "vitest";
export const register = vi.fn();
export const unregister = vi.fn();
export const get = vi.fn(() => undefined);
export const lateBind = vi.fn();
export const onBind = vi.fn();
