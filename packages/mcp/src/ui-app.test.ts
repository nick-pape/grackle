import { describe, test, expect } from "vitest";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { uiToolMeta, hostSupportsUiApps } from "./ui-app.js";

describe("uiToolMeta", () => {
  test("populates both the modern and legacy resource-uri keys", () => {
    const meta = uiToolMeta("ui://grackle/hello-widget");
    expect(meta).toMatchObject({
      ui: { resourceUri: "ui://grackle/hello-widget" },
      "ui/resourceUri": "ui://grackle/hello-widget",
    });
    // No visibility key when not provided.
    expect((meta.ui as Record<string, unknown>).visibility).toBeUndefined();
  });

  test("includes visibility when provided", () => {
    const meta = uiToolMeta("ui://grackle/x", ["model", "app"]);
    expect(meta.ui).toEqual({ resourceUri: "ui://grackle/x", visibility: ["model", "app"] });
  });
});

describe("hostSupportsUiApps", () => {
  const withUi = (mimeTypes?: string[]): ClientCapabilities =>
    ({ extensions: { [EXTENSION_ID]: mimeTypes ? { mimeTypes } : {} } }) as ClientCapabilities;

  test("false when capabilities are undefined", () => {
    expect(hostSupportsUiApps(undefined)).toBe(false);
  });

  test("false when the host advertises no extensions", () => {
    expect(hostSupportsUiApps({} as ClientCapabilities)).toBe(false);
  });

  test("false when the ui extension lacks the MCP App MIME type", () => {
    expect(hostSupportsUiApps(withUi())).toBe(false);
    expect(hostSupportsUiApps(withUi(["text/plain"]))).toBe(false);
  });

  test("true when the host advertises the ui extension with the MCP App MIME type", () => {
    expect(hostSupportsUiApps(withUi([RESOURCE_MIME_TYPE]))).toBe(true);
  });
});
