import { describe, it, expect } from "vitest";
import type { GrackleClients, ToolResult } from "../tool-registry.js";
import { DOCUMENT_SHOW_META_KEY, type DocumentShowDescriptor } from "../document-show-meta.js";
import { documentsTools } from "./documents.js";

const showFile = documentsTools.find((t) => t.name === "show_file")!;

/** Invoke the show_file handler (it only reads args; clients/auth are unused). */
async function run(args: Record<string, unknown>): Promise<ToolResult> {
  return showFile.handler(args, {} as GrackleClients, undefined);
}

describe("show_file tool", () => {
  it("is registered as a read-only document tool", () => {
    expect(showFile).toBeDefined();
    expect(showFile.group).toBe("document");
    expect(showFile.mutating).toBe(false);
    expect(showFile.annotations?.readOnlyHint).toBe(true);
  });

  it("converts an absolute path to a file:// URI on the result _meta", async () => {
    const result = await run({ path: "/repo/plan.md" });
    expect(result.isError).toBeFalsy();
    const descriptor = result._meta?.[DOCUMENT_SHOW_META_KEY] as DocumentShowDescriptor | undefined;
    expect(descriptor).toBeDefined();
    expect(descriptor!.uri.startsWith("file://")).toBe(true);
    // basename survives the conversion (exact prefix is platform-dependent).
    expect(descriptor!.uri).toContain("plan.md");
  });

  it("echoes the resolved uri in the text content", async () => {
    const result = await run({ path: "/repo/plan.md" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const parsed = JSON.parse(text) as { shown: boolean; uri: string };
    expect(parsed.shown).toBe(true);
    expect(parsed.uri.startsWith("file://")).toBe(true);
  });

  it("rejects a relative path with INVALID_ARGUMENT and no descriptor", async () => {
    const result = await run({ path: "relative/plan.md" });
    expect(result.isError).toBe(true);
    expect(result._meta?.[DOCUMENT_SHOW_META_KEY]).toBeUndefined();
  });

  it("rejects an empty path", async () => {
    const result = await run({ path: "" });
    expect(result.isError).toBe(true);
  });
});
