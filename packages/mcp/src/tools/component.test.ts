import { describe, test, expect } from "vitest";
import { componentTools } from "./component.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";
import { WIDGET_RENDER_META_KEY, type WidgetRenderDescriptor } from "../widget-render-meta.js";
import type { GrackleClients } from "../tool-registry.js";

const tool = (name: string) => componentTools.find((t) => t.name === name)!;
const helloTool = tool("show_hello_widget");
const componentShow = tool("component_show");
const widgetShow = tool("widget_show");
const componentRegister = tool("component_register");
const componentRender = tool("component_render");
const noClients = {} as GrackleClients;

/** Build a mock GrackleClients whose orchestration client returns a canned component. */
function clientsReturning(component: Record<string, unknown>): GrackleClients {
  return {
    orchestration: {
      getComponent: async () => component,
      registerComponent: async (req: Record<string, unknown>) => ({ id: "c-new", name: req.name, version: 1 }),
    },
  } as unknown as GrackleClients;
}

function descriptorOf(result: { _meta?: { [k: string]: unknown } }): WidgetRenderDescriptor {
  return result._meta?.[WIDGET_RENDER_META_KEY] as WidgetRenderDescriptor;
}

describe("show_hello_widget", () => {
  test("definition ties to the hello widget resource and is read-only", () => {
    expect(helloTool.uiResourceUri).toBe(HELLO_WIDGET_URI);
    expect(helloTool.mutating).toBe(false);
    expect(helloTool.annotations?.readOnlyHint).toBe(true);
  });

  test("defaults the message when omitted", async () => {
    const result = await helloTool.handler({}, noClients);
    const parsed = JSON.parse(result.content[0]!.text) as { message: string };
    expect(parsed.message).toBe("Hello from Grackle");
  });
});

describe("component_show (one-off JSX, #1268)", () => {
  test("emits a grackle-react descriptor with source, props, and unsafe-eval", async () => {
    const result = await componentShow.handler(
      { source: "render(<Callout>{props.msg}</Callout>)", props: { msg: "hi" } },
      noClients,
    );
    const d = descriptorOf(result);
    expect(d.rendererKind).toBe("grackle-react");
    expect(d.body).toContain("render(");
    expect(d.props).toEqual({ msg: "hi" });
    expect(d.allowUnsafeEval).toBe(true);
    expect(d.resourceUri).toBe("");
  });
});

describe("widget_show (one-off raw HTML)", () => {
  test("emits an mcp-app-html descriptor with inline scripts allowed", async () => {
    const result = await widgetShow.handler({ body: "<div>hi</div>" }, noClients);
    const d = descriptorOf(result);
    expect(d.rendererKind).toBe("mcp-app-html");
    expect(d.allowInlineScripts).toBe(true);
    expect(d.allowUnsafeEval).toBeUndefined();
  });
});

describe("component_register (#1269)", () => {
  test("rejects a malformed propsSchema before hitting the backend", async () => {
    const result = await componentRegister.handler(
      { workspaceId: "ws1", name: "c", source: "render(<i/>)", propsSchema: "{not json" },
      noClients,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("propsSchema");
  });

  test("rejects a propsSchema that is not an object", async () => {
    const result = await componentRegister.handler(
      { workspaceId: "ws1", name: "c", source: "render(<i/>)", propsSchema: "[1,2,3]" },
      noClients,
    );
    expect(result.isError).toBe(true);
  });

  test("registers with a valid propsSchema, defaulting to grackle-react", async () => {
    const calls: Record<string, unknown>[] = [];
    const clients = {
      orchestration: {
        registerComponent: async (req: Record<string, unknown>) => { calls.push(req); return { id: "c1", name: req.name, version: 1 }; },
      },
    } as unknown as GrackleClients;
    const result = await componentRegister.handler(
      { workspaceId: "ws1", name: "chart", source: "render(<i/>)", propsSchema: '{"type":"object"}' },
      clients,
    );
    expect(result.isError).toBeFalsy();
    expect(calls[0]!.rendererKind).toBe("grackle-react");
    expect(calls[0]!.body).toBe("render(<i/>)");
  });
});

describe("component_render (#1269)", () => {
  test("renders a grackle-react component with unsafe-eval (not inline scripts)", async () => {
    const clients = clientsReturning({ id: "c1", name: "chart", rendererKind: "grackle-react", body: "render(<i/>)", propsSchema: "", version: 2 });
    const result = await componentRender.handler({ name: "chart", props: { a: 1 } }, clients);
    const d = descriptorOf(result);
    expect(d.rendererKind).toBe("grackle-react");
    expect(d.allowUnsafeEval).toBe(true);
    expect(d.allowInlineScripts).toBe(false);
    expect(d.widgetId).toBe("c1");
  });

  test("renders an mcp-app-html component with inline scripts (not unsafe-eval)", async () => {
    const clients = clientsReturning({ id: "c2", name: "raw", rendererKind: "mcp-app-html", body: "<div/>", propsSchema: "", version: 1 });
    const result = await componentRender.handler({ id: "c2" }, clients);
    const d = descriptorOf(result);
    expect(d.allowInlineScripts).toBe(true);
    expect(d.allowUnsafeEval).toBe(false);
  });

  test("rejects props that violate the component's propsSchema", async () => {
    const schema = '{"type":"object","properties":{"x":{"type":"number"}},"required":["x"]}';
    const clients = clientsReturning({ id: "c3", name: "typed", rendererKind: "grackle-react", body: "render(<i/>)", propsSchema: schema, version: 1 });
    const bad = await componentRender.handler({ name: "typed", props: { x: "not-a-number" } }, clients);
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain("propsSchema");
    const ok = await componentRender.handler({ name: "typed", props: { x: 42 } }, clients);
    expect(ok.isError).toBeFalsy();
  });

  test("requires id or name", async () => {
    const result = await componentRender.handler({}, clientsReturning({}));
    expect(result.isError).toBe(true);
  });
});
