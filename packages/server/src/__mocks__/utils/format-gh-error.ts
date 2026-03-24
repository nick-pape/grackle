import { vi } from "vitest";
export const formatGhError: ReturnType<typeof vi.fn> = vi.fn((err: unknown) => String(err));
