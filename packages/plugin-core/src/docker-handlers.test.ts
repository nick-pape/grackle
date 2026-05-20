import { describe, it, expect, vi, beforeEach } from "vitest";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("@grackle-ai/core", () => ({
  exec: execMock,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { listDockerContainers } from "./docker-handlers.js";

beforeEach(() => {
  execMock.mockReset();
});

describe("listDockerContainers", () => {
  it("parses `docker ps` JSON-per-line output", async () => {
    execMock.mockResolvedValue({
      stdout: [
        JSON.stringify({ ID: "abc123", Names: "demo-ext", Image: "node:22", State: "running", Status: "Up 3 minutes" }),
        JSON.stringify({ ID: "def456", Names: "other", Image: "alpine", State: "running", Status: "Up 1 hour" }),
      ].join("\n"),
      stderr: "",
    });

    const res = await listDockerContainers({} as never);

    expect(res.containers).toHaveLength(2);
    expect(res.containers[0]).toMatchObject({
      id: "abc123",
      name: "demo-ext",
      image: "node:22",
      state: "running",
      status: "Up 3 minutes",
    });
    expect(res.error).toBe("");
    expect(execMock).toHaveBeenCalledWith(
      "docker",
      ["ps", "--no-trunc", "--format", "{{json .}}"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("returns a non-fatal error when the docker CLI is unavailable", async () => {
    execMock.mockRejectedValue(new Error("docker: command not found"));

    const res = await listDockerContainers({} as never);

    expect(res.containers).toHaveLength(0);
    expect(res.error).toContain("command not found");
  });

  it("filters out Grackle's own socat sidecars (grackle-attach-*)", async () => {
    execMock.mockResolvedValue({
      stdout: [
        JSON.stringify({ ID: "abc123", Names: "coder-sim", Image: "node:22", State: "running", Status: "Up 4 minutes" }),
        JSON.stringify({ ID: "side01", Names: "grackle-attach-coder-sim", Image: "alpine/socat", State: "running", Status: "Up 1 minute" }),
      ].join("\n"),
      stderr: "",
    });

    const res = await listDockerContainers({} as never);

    expect(res.containers).toHaveLength(1);
    expect(res.containers[0]!.name).toBe("coder-sim");
    expect(res.containers.some((c) => c.name.startsWith("grackle-attach-"))).toBe(false);
  });

  it("ignores blank lines", async () => {
    execMock.mockResolvedValue({ stdout: "\n\n  \n", stderr: "" });

    const res = await listDockerContainers({} as never);

    expect(res.containers).toHaveLength(0);
  });
});
