import { describe, it, expect } from "vitest";
import { SESSION_STATUS, TERMINAL_SESSION_STATUSES } from "./types.js";
import { powerline } from "./index.js";

describe("SESSION_STATUS", () => {
  it("includes SUSPENDED", () => {
    expect(SESSION_STATUS.SUSPENDED).toBe("suspended");
  });

  it("SUSPENDED is not a terminal status", () => {
    expect(TERMINAL_SESSION_STATUSES.has(SESSION_STATUS.SUSPENDED)).toBe(false);
  });
});

describe("DrainBufferedEvents proto", () => {
  it("DrainRequestSchema is exported", () => {
    expect(powerline.DrainRequestSchema).toBeDefined();
  });

  it("GracklePowerLine service descriptor is defined", () => {
    expect(powerline.GracklePowerLine).toBeDefined();
    expect(powerline.GracklePowerLine.typeName).toBe("grackle.powerline.GracklePowerLine");
    // Verify DrainBufferedEvents is in the service method list
    const methods = powerline.GracklePowerLine.methods as unknown as Array<{ name: string }>;
    expect(methods.some((m) => m.name === "DrainBufferedEvents")).toBe(true);
  });
});
