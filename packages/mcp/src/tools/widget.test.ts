import { describe, test, expect } from "vitest";
import { widgetTools } from "./widget.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";
import { WIDGET_RENDER_META_KEY, type WidgetRenderDescriptor } from "../widget-render-meta.js";
import type { GrackleClients } from "../tool-registry.js";

const tool = widgetTools.find((t) => t.name === "show_hello_widget")!;
const componentShow = widgetTools.find((t) => t.name === "component_show")!;
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

describe("component_show (#1268 React runtime)", () => {
  test("is a read-only widget-group tool", () => {
    expect(componentShow.group).toBe("widget");
    expect(componentShow.mutating).toBe(false);
    expect(componentShow.annotations?.readOnlyHint).toBe(true);
  });

  test("emits a grackle-react descriptor with the JSX source, props, and unsafe-eval", async () => {
    const result = await componentShow.handler(
      { source: "render(<Callout>{props.msg}</Callout>)", props: { msg: "hi" } },
      noClients,
    );
    const descriptor = result._meta?.[WIDGET_RENDER_META_KEY] as WidgetRenderDescriptor;
    expect(descriptor.rendererKind).toBe("grackle-react");
    expect(descriptor.body).toContain("render(");
    expect(descriptor.props).toEqual({ msg: "hi" });
    expect(descriptor.allowUnsafeEval).toBe(true);
    expect(descriptor.resourceUri).toBe("");
  });

  test("defaults props to an empty object", async () => {
    const result = await componentShow.handler({ source: "render(<Spinner/>)" }, noClients);
    const descriptor = result._meta?.[WIDGET_RENDER_META_KEY] as WidgetRenderDescriptor;
    expect(descriptor.props).toEqual({});
  });
});
