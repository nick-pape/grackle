import { describe, test, expect } from "vitest";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { ResourceRegistry, type ResourceDefinition } from "./resource-registry.js";
import { createResourceRegistry } from "./resources/index.js";
import { HELLO_WIDGET_URI, WIDGET_ASSET_BASE_PATH } from "./resources/hello-widget.js";

const def = (uri: string): ResourceDefinition => ({
  uri,
  name: uri,
  mimeType: "text/plain",
  read: () => ({ text: "body" }),
});

describe("ResourceRegistry", () => {
  test("register / get / list", () => {
    const reg = new ResourceRegistry();
    reg.register(def("ui://a"));
    reg.register(def("ui://b"));
    expect(reg.get("ui://a")?.uri).toBe("ui://a");
    expect(reg.list().map((r) => r.uri)).toEqual(["ui://a", "ui://b"]);
  });

  test("duplicate uri throws", () => {
    const reg = new ResourceRegistry();
    reg.register(def("ui://a"));
    expect(() => reg.register(def("ui://a"))).toThrow(/Duplicate resource uri/);
  });

  test("unknown uri returns undefined", () => {
    expect(new ResourceRegistry().get("ui://missing")).toBeUndefined();
  });
});

describe("createResourceRegistry", () => {
  const baseUrl = "http://127.0.0.1:7435";
  const reg = createResourceRegistry(baseUrl);

  test("registers exactly the hello widget with the MCP App MIME type", () => {
    const all = reg.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.uri).toBe(HELLO_WIDGET_URI);
    expect(all[0]!.mimeType).toBe(RESOURCE_MIME_TYPE);
  });

  test("read() returns HTML referencing the asset script at the base URL", () => {
    const html = reg.get(HELLO_WIDGET_URI)!.read().text;
    expect(html).toContain('id="input"');
    expect(html).toContain('id="result"');
    expect(html).toContain(`${baseUrl}${WIDGET_ASSET_BASE_PATH}/index.js`);
  });
});
