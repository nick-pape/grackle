import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { versionTools } from "./version.js";

type GrackleClient = Client<typeof grackle.GrackleCore>;

const getTool = (name: string) => versionTools.find((t) => t.name === name)!;

describe("get_version_status", () => {
  const tool = getTool("get_version_status");

  test("happy path — returns version status", async () => {
    const mockClient = {
      getVersionStatus: vi.fn().mockResolvedValue({
        currentVersion: "0.76.0",
        latestVersion: "0.77.0",
        updateAvailable: true,
        isDocker: false,
      }),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, { core: mockClient });

    expect(mockClient.getVersionStatus).toHaveBeenCalledWith({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.currentVersion).toBe("0.76.0");
    expect(parsed.latestVersion).toBe("0.77.0");
    expect(parsed.updateAvailable).toBe(true);
    expect(parsed.isDocker).toBe(false);
    expect(result.isError).toBeUndefined();
  });

  test("gRPC ConnectError returns isError", async () => {
    const mockClient = {
      getVersionStatus: vi.fn().mockRejectedValue(
        new ConnectError("unavailable", Code.Unavailable),
      ),
    } as unknown as GrackleClient;

    const result = await tool.handler({}, { core: mockClient });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("unavailable");
  });
});
