import { describe, it, expect } from "vitest";
import { resolvePreviewKind } from "./PreviewRegistry.js";

describe("resolvePreviewKind", () => {
  it("treats markdown content-type as markdown", () => {
    expect(resolvePreviewKind("utf-8", "text/markdown", "file:///x/readme")).toBe("markdown");
  });

  it("treats .md / .markdown / .mdx extensions as markdown", () => {
    expect(resolvePreviewKind("utf-8", "", "file:///x/plan.md")).toBe("markdown");
    expect(resolvePreviewKind("utf-8", "", "file:///x/notes.markdown")).toBe("markdown");
    expect(resolvePreviewKind("utf-8", "", "file:///x/doc.mdx")).toBe("markdown");
  });

  it("treats other utf-8 text as code", () => {
    expect(resolvePreviewKind("utf-8", "text/plain", "file:///x/main.ts")).toBe("code");
    expect(resolvePreviewKind("utf-8", "", "file:///x/server.py")).toBe("code");
    expect(resolvePreviewKind("", "", "file:///x/Makefile")).toBe("code");
  });

  it("treats base64 / non-utf-8 (binary) content as fallback", () => {
    expect(resolvePreviewKind("base64", "image/png", "file:///x/logo.png")).toBe("fallback");
    expect(resolvePreviewKind("base64", "", "file:///x/video.mp4")).toBe("fallback");
    expect(resolvePreviewKind("BASE64", "", "file:///x/a.bin")).toBe("fallback");
  });

  it("prefers markdown over the code default even when extension is unusual", () => {
    expect(resolvePreviewKind("utf-8", "text/markdown; charset=utf-8", "file:///x/CHANGES")).toBe(
      "markdown",
    );
  });

  it("is case-insensitive on the extension", () => {
    expect(resolvePreviewKind("utf-8", "", "file:///x/README.MD")).toBe("markdown");
  });
});
