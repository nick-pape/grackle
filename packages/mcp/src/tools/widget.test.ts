import { describe, test, expect } from "vitest";
import { widgetTools } from "./widget.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";
import type { GrackleClients } from "../tool-registry.js";

const tool = widgetTools.find((t) => t.name === "show_hello_widget")!;
const noClients = {} as GrackleClients;

describe("show_hello_widget", () => {
  test("definition ties to the hello widget resource and is read-only", () => {
    expect(tool.uiResourceUri).toBe(HELLO_WIDGET_URI);
    expect(tool.group).toBe("widget");
    expect(tool.mutating).toBe(false);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  test("echoes the provided message", async () => {
    const result = await tool.handler({ message: "hi there" }, noClients);
    const parsed = JSON.parse(result.content[0]!.text) as { message: string; renderedAt: string };
    expect(parsed.message).toBe("hi there");
    expect(typeof parsed.renderedAt).toBe("string");
  });

  test("defaults the message when omitted", async () => {
    const result = await tool.handler({}, noClients);
    const parsed = JSON.parse(result.content[0]!.text) as { message: string };
    expect(parsed.message).toBe("Hello from Grackle");
  });
});
