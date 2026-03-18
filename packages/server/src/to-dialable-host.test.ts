/**
 * Tests for the toDialableHost() logic in grpc-service.ts.
 * Since the function is not exported, we replicate its logic here
 * to validate the GRACKLE_DOCKER_HOST behavior independently.
 */
import { describe, it, expect, afterEach } from "vitest";

/**
 * Mirrors toDialableHost() from grpc-service.ts.
 * Kept in sync manually — if the source changes, update this copy.
 */
function toDialableHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    const dockerHost = process.env.GRACKLE_DOCKER_HOST;
    if (dockerHost) {
      return dockerHost;
    }
    return bindHost === "::" ? "[::1]" : "127.0.0.1";
  }
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

describe("toDialableHost()", () => {
  afterEach(() => {
    delete process.env.GRACKLE_DOCKER_HOST;
  });

  it("maps 0.0.0.0 to 127.0.0.1 by default", () => {
    expect(toDialableHost("0.0.0.0")).toBe("127.0.0.1");
  });

  it("maps :: to [::1] by default", () => {
    expect(toDialableHost("::")).toBe("[::1]");
  });

  it("returns GRACKLE_DOCKER_HOST when set and bindHost is 0.0.0.0", () => {
    process.env.GRACKLE_DOCKER_HOST = "grackle";
    expect(toDialableHost("0.0.0.0")).toBe("grackle");
  });

  it("returns GRACKLE_DOCKER_HOST when set and bindHost is ::", () => {
    process.env.GRACKLE_DOCKER_HOST = "grackle";
    expect(toDialableHost("::")).toBe("grackle");
  });

  it("does not use GRACKLE_DOCKER_HOST for explicit bind addresses", () => {
    process.env.GRACKLE_DOCKER_HOST = "grackle";
    expect(toDialableHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("wraps IPv6 addresses in brackets", () => {
    expect(toDialableHost("::1")).toBe("[::1]");
    expect(toDialableHost("fe80::1")).toBe("[fe80::1]");
  });

  it("returns IPv4 addresses as-is", () => {
    expect(toDialableHost("192.168.1.1")).toBe("192.168.1.1");
  });
});
