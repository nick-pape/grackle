// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { McpAppWidget } from "./McpAppWidget.js";

describe("McpAppWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("mounts an iframe host for the widget", () => {
    render(
      <McpAppWidget
        widgetHtml="<!doctype html><html><body>hi</body></html>"
        sandboxProxyUrl="http://localhost:6007/sandbox.html"
      />,
    );
    const iframe = screen.getByTestId("mcp-app-widget");
    expect(iframe.tagName.toLowerCase()).toBe("iframe");
  });

  it("points the iframe at the sandbox proxy origin", () => {
    render(
      <McpAppWidget
        widgetHtml="<!doctype html><html><body>hi</body></html>"
        sandboxProxyUrl="http://localhost:6007/sandbox.html"
      />,
    );
    const iframe = screen.getByTestId("mcp-app-widget") as HTMLIFrameElement;
    expect(iframe.getAttribute("src") ?? "").toContain("localhost:6007");
  });
});
