import { describe, it, expect } from "vitest";
import { formatVersionNotice } from "./version-notice.js";

describe("formatVersionNotice", () => {
  it("returns formatted string when update available (npm)", () => {
    const result = formatVersionNotice({
      currentVersion: "0.76.0",
      latestVersion: "0.77.0",
      updateAvailable: true,
      isDocker: false,
    });

    expect(result).toContain("0.77.0");
    expect(result).toContain("npm install");
  });

  it("returns formatted string when update available (Docker)", () => {
    const result = formatVersionNotice({
      currentVersion: "0.76.0",
      latestVersion: "0.77.0",
      updateAvailable: true,
      isDocker: true,
    });

    expect(result).toContain("0.77.0");
    expect(result).toContain("docker pull");
  });

  it("returns empty string when no update available", () => {
    const result = formatVersionNotice({
      currentVersion: "0.76.0",
      latestVersion: "0.76.0",
      updateAvailable: false,
      isDocker: false,
    });

    expect(result).toBe("");
  });
});
