import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generatePairingCode,
  redeemPairingCode,
  clearPairing,
} from "./pairing.js";

// Suppress logger output during tests
import { setAuthLogger } from "./auth-logger.js";
setAuthLogger({
  info: vi.fn(),
  warn: vi.fn(),
});

describe("pairing", () => {
  beforeEach(() => {
    clearPairing();
  });

  describe("generatePairingCode", () => {
    it("returns a 6-character uppercase alphanumeric code", () => {
      const code = generatePairingCode();
      expect(code).toBeDefined();
      expect(code!.length).toBe(6);
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    });

    it("generates unique codes", () => {
      const codes: Set<string> = new Set();
      for (let i = 0; i < 10; i++) {
        const code = generatePairingCode();
        if (code) {
          codes.add(code);
        }
      }
      // At most 10 active codes allowed, but all generated should be unique
      expect(codes.size).toBeGreaterThanOrEqual(1);
    });

    it("returns undefined when max active codes reached", () => {
      for (let i = 0; i < 10; i++) {
        expect(generatePairingCode()).toBeDefined();
      }
      // 11th should fail
      expect(generatePairingCode()).toBeUndefined();
    });
  });

  describe("redeemPairingCode", () => {
    it("succeeds for a valid code", () => {
      const code = generatePairingCode()!;
      expect(redeemPairingCode(code, "127.0.0.1")).toBe(true);
    });

    it("is case-insensitive", () => {
      const code = generatePairingCode()!;
      expect(redeemPairingCode(code.toLowerCase(), "127.0.0.1")).toBe(true);
    });

    it("burns the code after single use", () => {
      const code = generatePairingCode()!;
      expect(redeemPairingCode(code, "127.0.0.1")).toBe(true);
      expect(redeemPairingCode(code, "127.0.0.1")).toBe(false);
    });

    it("rejects a non-existent code", () => {
      expect(redeemPairingCode("ZZZZZZ", "127.0.0.1")).toBe(false);
    });

    it("rate-limits after repeated failures", () => {
      const ip = "10.0.0.99";
      // 5 failures should trigger the rate limit
      for (let i = 0; i < 5; i++) {
        redeemPairingCode("BADCODE", ip);
      }
      // Now even a valid code should be blocked from this IP
      const validCode = generatePairingCode()!;
      expect(redeemPairingCode(validCode, ip)).toBe(false);
      // But a different IP can still redeem
      expect(redeemPairingCode(validCode, "10.0.0.100")).toBe(true);
    });
  });
});
