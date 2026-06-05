import { describe, it, expect, afterEach } from "vitest";
import { toDialableHost } from "./grpc-shared-utils.js";

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

  it("uses explicit dockerHost parameter when bindHost is 0.0.0.0", () => {
    expect(toDialableHost("0.0.0.0", "grackle")).toBe("grackle");
  });

  it("uses explicit dockerHost parameter when bindHost is ::", () => {
    expect(toDialableHost("::", "grackle")).toBe("grackle");
  });

  it("falls back to GRACKLE_DOCKER_HOST env when dockerHost not passed", () => {
    process.env.GRACKLE_DOCKER_HOST = "grackle-env";
    expect(toDialableHost("0.0.0.0")).toBe("grackle-env");
  });

  it("explicit dockerHost takes precedence over env var", () => {
    process.env.GRACKLE_DOCKER_HOST = "from-env";
    expect(toDialableHost("0.0.0.0", "from-param")).toBe("from-param");
  });

  it("wraps IPv6 dockerHost in brackets", () => {
    expect(toDialableHost("0.0.0.0", "fd12::1")).toBe("[fd12::1]");
  });

  it("wraps IPv6 dockerHost in brackets when bindHost is ::", () => {
    expect(toDialableHost("::", "fd12::1")).toBe("[fd12::1]");
  });

  it("returns non-IPv6 dockerHost unchanged", () => {
    expect(toDialableHost("0.0.0.0", "grackle.local")).toBe("grackle.local");
  });

  it("does not double-wrap already-bracketed IPv6 dockerHost", () => {
    expect(toDialableHost("0.0.0.0", "[fd12::1]")).toBe("[fd12::1]");
  });

  it("does not use dockerHost for explicit bind addresses", () => {
    expect(toDialableHost("127.0.0.1", "grackle")).toBe("127.0.0.1");
  });

  it("wraps IPv6 addresses in brackets", () => {
    expect(toDialableHost("::1")).toBe("[::1]");
    expect(toDialableHost("fe80::1")).toBe("[fe80::1]");
  });

  it("returns IPv4 addresses as-is", () => {
    expect(toDialableHost("192.168.1.1")).toBe("192.168.1.1");
  });
});
