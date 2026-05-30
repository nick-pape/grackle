import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_PORT,
  DEFAULT_MCP_PORT,
  DEFAULT_POWERLINE_PORT,
} from "@grackle-ai/common";

import { resolveServerConfig } from "./config.js";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveServerConfig", () => {
  it("returns defaults when no env vars are set", () => {
    // Explicitly clear all config env vars in case the test runner has them set
    vi.stubEnv("GRACKLE_PORT", "");
    vi.stubEnv("GRACKLE_WEB_PORT", "");
    vi.stubEnv("GRACKLE_MCP_PORT", "");
    vi.stubEnv("GRACKLE_POWERLINE_PORT", "");
    vi.stubEnv("GRACKLE_HOST", "");
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "");

    const config = resolveServerConfig();
    expect(config.grpcPort).toBe(DEFAULT_SERVER_PORT);
    expect(config.webPort).toBe(DEFAULT_WEB_PORT);
    expect(config.mcpPort).toBe(DEFAULT_MCP_PORT);
    expect(config.powerlinePort).toBe(DEFAULT_POWERLINE_PORT);
    expect(config.host).toBe("127.0.0.1");
    expect(config.skipLocalPowerline).toBe(false);
    expect(config.skipRootAutostart).toBe(false);
  });

  it("parses valid port numbers from env vars", () => {
    vi.stubEnv("GRACKLE_PORT", "9000");
    vi.stubEnv("GRACKLE_WEB_PORT", "9001");
    vi.stubEnv("GRACKLE_MCP_PORT", "9002");
    vi.stubEnv("GRACKLE_POWERLINE_PORT", "9003");

    const config = resolveServerConfig();
    expect(config.grpcPort).toBe(9000);
    expect(config.webPort).toBe(9001);
    expect(config.mcpPort).toBe(9002);
    expect(config.powerlinePort).toBe(9003);
  });

  it("throws on non-numeric port value", () => {
    vi.stubEnv("GRACKLE_PORT", "banana");
    expect(() => resolveServerConfig()).toThrow('Invalid port for GRACKLE_PORT: "banana"');
  });

  it("throws on port below 1", () => {
    vi.stubEnv("GRACKLE_PORT", "0");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on negative port", () => {
    vi.stubEnv("GRACKLE_PORT", "-1");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on port with trailing garbage", () => {
    vi.stubEnv("GRACKLE_PORT", "9000abc");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on decimal port", () => {
    vi.stubEnv("GRACKLE_PORT", "9000.5");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("throws on port above 65535", () => {
    vi.stubEnv("GRACKLE_PORT", "70000");
    expect(() => resolveServerConfig()).toThrow("Invalid port for GRACKLE_PORT");
  });

  it("accepts port 1 (min valid)", () => {
    vi.stubEnv("GRACKLE_PORT", "1");
    expect(resolveServerConfig().grpcPort).toBe(1);
  });

  it("accepts port 65535 (max valid)", () => {
    vi.stubEnv("GRACKLE_PORT", "65535");
    expect(resolveServerConfig().grpcPort).toBe(65535);
  });

  it("parses boolean flags — '1' is true", () => {
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "1");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "1");

    const config = resolveServerConfig();
    expect(config.skipLocalPowerline).toBe(true);
    expect(config.skipRootAutostart).toBe(true);
  });

  it("parses boolean flags — anything else is false", () => {
    vi.stubEnv("GRACKLE_SKIP_LOCAL_POWERLINE", "true");
    vi.stubEnv("GRACKLE_SKIP_ROOT_AUTOSTART", "0");

    const config = resolveServerConfig();
    expect(config.skipLocalPowerline).toBe(false);
    expect(config.skipRootAutostart).toBe(false);
  });

  it("uses GRACKLE_HOST when set", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    // 0.0.0.0 trips the #1374 network-exposure gate; satisfy it via the
    // explicit opt-in so this test stays focused on the host-resolution path.
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "1");
    expect(resolveServerConfig().host).toBe("0.0.0.0");
  });

  describe("GRACKLE_PUBLIC_URL", () => {
    it("is undefined when unset", () => {
      expect(resolveServerConfig().publicUrl).toBeUndefined();
    });

    it("accepts an https origin and normalizes it", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "https://grackle.home");
      expect(resolveServerConfig().publicUrl).toBe("https://grackle.home");
    });

    it("accepts an http origin", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "http://grackle.home:8080");
      expect(resolveServerConfig().publicUrl).toBe("http://grackle.home:8080");
    });

    it("strips a trailing slash via origin normalization", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "https://grackle.home/");
      expect(resolveServerConfig().publicUrl).toBe("https://grackle.home");
    });

    it("throws on a non-URL value", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "not-a-url");
      expect(() => resolveServerConfig()).toThrow("Invalid GRACKLE_PUBLIC_URL");
    });

    it("throws on a non-http(s) scheme", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "ftp://grackle.home");
      expect(() => resolveServerConfig()).toThrow("Scheme must be http or https");
    });

    it("throws when the URL has a path", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "https://grackle.home/grackle");
      expect(() => resolveServerConfig()).toThrow("bare origin with no path");
    });

    it("throws when the URL has a query string", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "https://grackle.home?foo=bar");
      expect(() => resolveServerConfig()).toThrow("bare origin with no path");
    });

    it("throws when the URL embeds userinfo", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "https://user:pass@grackle.home");
      expect(() => resolveServerConfig()).toThrow("must not contain a username or password");
    });

    it("trims surrounding whitespace", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "  https://grackle.home  ");
      expect(resolveServerConfig().publicUrl).toBe("https://grackle.home");
    });

    it("treats a whitespace-only value as unset", () => {
      vi.stubEnv("GRACKLE_PUBLIC_URL", "   ");
      expect(resolveServerConfig().publicUrl).toBeUndefined();
    });
  });

  it("returns a frozen object", () => {
    const config = resolveServerConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe("resolveServerConfig — TLS (#1373)", () => {
  let tmp: string;
  let certPath: string;
  let keyPath: string;
  let chainPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "grackle-tls-cfg-"));
    certPath = join(tmp, "cert.pem");
    keyPath = join(tmp, "key.pem");
    chainPath = join(tmp, "chain.pem");
    // Contents don't matter for config validation — only readability.
    writeFileSync(certPath, "CERT");
    writeFileSync(keyPath, "KEY");
    writeFileSync(chainPath, "CHAIN");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns tls=undefined when no TLS env vars are set", () => {
    expect(resolveServerConfig().tls).toBeUndefined();
  });

  it("populates tls when both cert and key are set", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    const cfg = resolveServerConfig();
    expect(cfg.tls).toEqual({ certPath, keyPath });
  });

  it("carries chainPath through when GRACKLE_TLS_CHAIN is set", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    vi.stubEnv("GRACKLE_TLS_CHAIN", chainPath);
    expect(resolveServerConfig().tls).toEqual({ certPath, keyPath, chainPath });
  });

  it("throws when only GRACKLE_TLS_CERT is set", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    expect(() => resolveServerConfig()).toThrow(/must both be set, or neither/);
  });

  it("throws when only GRACKLE_TLS_KEY is set", () => {
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    expect(() => resolveServerConfig()).toThrow(/must both be set, or neither/);
  });

  it("throws when GRACKLE_TLS_CHAIN is set without cert+key", () => {
    vi.stubEnv("GRACKLE_TLS_CHAIN", chainPath);
    expect(() => resolveServerConfig()).toThrow(/GRACKLE_TLS_CHAIN is set but/);
  });

  it("throws when GRACKLE_TLS_CERT points to a missing file", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", join(tmp, "nope.pem"));
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    expect(() => resolveServerConfig()).toThrow(/GRACKLE_TLS_CERT.*not readable/);
  });

  it("throws when GRACKLE_TLS_KEY points to a missing file", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    vi.stubEnv("GRACKLE_TLS_KEY", join(tmp, "nope.pem"));
    expect(() => resolveServerConfig()).toThrow(/GRACKLE_TLS_KEY.*not readable/);
  });

  it("throws when GRACKLE_TLS_CHAIN points to a missing file", () => {
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    vi.stubEnv("GRACKLE_TLS_CHAIN", join(tmp, "nope.pem"));
    expect(() => resolveServerConfig()).toThrow(/GRACKLE_TLS_CHAIN.*not readable/);
  });
});

describe("resolveServerConfig — network exposure gate (#1374)", () => {
  let tmp: string;
  let certPath: string;
  let keyPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "grackle-exposure-"));
    certPath = join(tmp, "cert.pem");
    keyPath = join(tmp, "key.pem");
    writeFileSync(certPath, "CERT");
    writeFileSync(keyPath, "KEY");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Pass-through (loopback) ────────────────────────────────
  it("loopback 127.0.0.1 + no opt-in: OK", () => {
    // Default — no env vars set; host falls back to "127.0.0.1".
    expect(() => resolveServerConfig()).not.toThrow();
  });

  it("loopback localhost + no opt-in: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "localhost");
    expect(() => resolveServerConfig()).not.toThrow();
  });

  it("loopback ::1 + no opt-in: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "::1");
    expect(() => resolveServerConfig()).not.toThrow();
  });

  // ── Pass-through (non-loopback with TLS or opt-in) ─────────
  it("0.0.0.0 + native TLS: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_TLS_CERT", certPath);
    vi.stubEnv("GRACKLE_TLS_KEY", keyPath);
    const cfg = resolveServerConfig();
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.tls).toBeTruthy();
    expect(cfg.allowInsecure).toBe(false);
  });

  it("0.0.0.0 + https publicUrl: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_PUBLIC_URL", "https://grackle.example");
    expect(() => resolveServerConfig()).not.toThrow();
  });

  it("0.0.0.0 + GRACKLE_ALLOW_INSECURE=1: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "1");
    const cfg = resolveServerConfig();
    expect(cfg.allowInsecure).toBe(true);
  });

  it("0.0.0.0 + http publicUrl + opt-in: OK (deliberate cleartext proxy)", () => {
    // Operator advertises an http://internal proxy origin and explicitly
    // accepts cleartext via the opt-in. Allowed because the choice is conscious.
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_PUBLIC_URL", "http://grackle.internal");
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "1");
    expect(() => resolveServerConfig()).not.toThrow();
  });

  // ── Fail-fast (non-loopback without any satisfier) ─────────
  it("0.0.0.0 + nothing: throws with all three satisfiers in the message", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    const run = (): unknown => resolveServerConfig();
    expect(run).toThrow(/Insecure network exposure/);
    expect(run).toThrow(/GRACKLE_TLS_CERT/);
    expect(run).toThrow(/GRACKLE_PUBLIC_URL=https/);
    expect(run).toThrow(/GRACKLE_ALLOW_INSECURE=1/);
    expect(run).toThrow(/GHSA-wcpf-6gwv-47c8/);
  });

  it("0.0.0.0 + http publicUrl alone (no opt-in): throws", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_PUBLIC_URL", "http://grackle.internal");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
  });

  it("IPv6 wildcard :: + nothing: throws", () => {
    vi.stubEnv("GRACKLE_HOST", "::");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
  });

  it("IPv6 wildcard 0:0:0:0:0:0:0:0 + nothing: throws", () => {
    vi.stubEnv("GRACKLE_HOST", "0:0:0:0:0:0:0:0");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
  });

  it("explicit LAN IP + nothing: throws", () => {
    vi.stubEnv("GRACKLE_HOST", "192.168.1.10");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
  });

  it("explicit LAN IP + insecure opt-in: OK", () => {
    vi.stubEnv("GRACKLE_HOST", "192.168.1.10");
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "1");
    expect(() => resolveServerConfig()).not.toThrow();
  });

  it("allowInsecure boolean is in the resolved config", () => {
    expect(resolveServerConfig().allowInsecure).toBe(false);
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "1");
    expect(resolveServerConfig().allowInsecure).toBe(true);
  });

  it("allowInsecure parses '1' only — 'true' / 'yes' do NOT enable it", () => {
    vi.stubEnv("GRACKLE_HOST", "0.0.0.0");
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "true");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
    vi.stubEnv("GRACKLE_ALLOW_INSECURE", "yes");
    expect(() => resolveServerConfig()).toThrow(/Insecure network exposure/);
  });
});
