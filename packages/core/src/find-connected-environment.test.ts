import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@grackle-ai/database", () => ({
  envRegistry: {
    listEnvironments: vi.fn(),
  },
}));

import { findFirstConnectedEnvironment } from "./find-connected-environment.js";
import { envRegistry } from "@grackle-ai/database";

const mockList = vi.mocked(envRegistry.listEnvironments);

describe("findFirstConnectedEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers local adapter when both local and SSH are connected", () => {
    mockList.mockReturnValue([
      { id: "ssh-1", status: "connected", adapterType: "ssh" },
      { id: "local-1", status: "connected", adapterType: "local" },
    ] as ReturnType<typeof envRegistry.listEnvironments>);

    const env = findFirstConnectedEnvironment();
    expect(env?.id).toBe("local-1");
  });

  it("returns SSH when no local is connected", () => {
    mockList.mockReturnValue([
      { id: "ssh-1", status: "connected", adapterType: "ssh" },
      { id: "local-1", status: "disconnected", adapterType: "local" },
    ] as ReturnType<typeof envRegistry.listEnvironments>);

    const env = findFirstConnectedEnvironment();
    expect(env?.id).toBe("ssh-1");
  });

  it("returns undefined when no environments are connected", () => {
    mockList.mockReturnValue([
      { id: "local-1", status: "disconnected", adapterType: "local" },
      { id: "ssh-1", status: "error", adapterType: "ssh" },
    ] as ReturnType<typeof envRegistry.listEnvironments>);

    expect(findFirstConnectedEnvironment()).toBeUndefined();
  });

  it("returns undefined when no environments exist", () => {
    mockList.mockReturnValue([]);
    expect(findFirstConnectedEnvironment()).toBeUndefined();
  });

  it("returns first local when multiple locals are connected", () => {
    mockList.mockReturnValue([
      { id: "local-1", status: "connected", adapterType: "local" },
      { id: "local-2", status: "connected", adapterType: "local" },
    ] as ReturnType<typeof envRegistry.listEnvironments>);

    const env = findFirstConnectedEnvironment();
    expect(env?.id).toBe("local-1");
  });
});
