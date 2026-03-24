import { vi } from "vitest";
export const formatGhError = vi.fn((err: unknown) => String(err));
