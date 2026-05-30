/**
 * Unit tests for the pure filesystem core behind the AHP `resources` read
 * capability. Exercises real temp directories (no wire, no AHP socket).
 */

import { AhpErrorCodes, ContentEncoding, JsonRpcErrorCodes } from "@grackle-ai/ahp";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  contentTypeFor,
  isResourceError,
  listResource,
  readResource,
  resourceUriToPath,
  ResourceError,
} from "./resource-fs.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "grackle-rfs-root-"));
  outside = await mkdtemp(join(tmpdir(), "grackle-rfs-out-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** Convenience: file:// URI for a path under a base directory. */
function uriIn(base: string, ...segments: string[]): string {
  return pathToFileURL(join(base, ...segments)).href;
}

/** Await a thrown ResourceError and return it (fails the test if none thrown). */
async function expectResourceError(promise: Promise<unknown>): Promise<ResourceError> {
  try {
    await promise;
  } catch (err) {
    if (isResourceError(err)) {
      return err;
    }
    throw new Error(`Expected ResourceError, got: ${String(err)}`);
  }
  throw new Error("Expected promise to reject with a ResourceError");
}

describe("resourceUriToPath", () => {
  it("converts a file:// URI to a path", () => {
    const path = resourceUriToPath(uriIn(root, "a.txt"));
    expect(path).toBe(join(root, "a.txt"));
  });

  it("rejects a non-file scheme with InvalidParams", () => {
    let caught: ResourceError | undefined;
    try {
      resourceUriToPath("https://example.com/x");
    } catch (err) {
      caught = isResourceError(err) ? err : undefined;
    }
    expect(caught?.code).toBe(JsonRpcErrorCodes.InvalidParams);
  });

  it("rejects a malformed URI with InvalidParams", () => {
    let caught: ResourceError | undefined;
    try {
      resourceUriToPath("not a uri");
    } catch (err) {
      caught = isResourceError(err) ? err : undefined;
    }
    expect(caught?.code).toBe(JsonRpcErrorCodes.InvalidParams);
  });
});

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    expect(contentTypeFor("/x/plan.md")).toBe("text/markdown");
    expect(contentTypeFor("/x/readme.markdown")).toBe("text/markdown");
    expect(contentTypeFor("/x/notes.txt")).toBe("text/plain");
    expect(contentTypeFor("/x/data.json")).toBe("application/json");
    expect(contentTypeFor("/x/pic.png")).toBe("image/png");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(contentTypeFor("/x/blob.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/x/noext")).toBe("application/octet-stream");
  });
});

describe("readResource", () => {
  it("reads a utf-8 text file with content type", async () => {
    await writeFile(join(root, "plan.md"), "# Plan\nhello", "utf-8");
    const result = await readResource(uriIn(root, "plan.md"), [root]);
    expect(result.encoding).toBe(ContentEncoding.Utf8);
    expect(result.contentType).toBe("text/markdown");
    expect(result.data).toBe("# Plan\nhello");
  });

  it("defaults binary content to base64", async () => {
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
    await writeFile(join(root, "blob.bin"), bytes);
    const result = await readResource(uriIn(root, "blob.bin"), [root]);
    expect(result.encoding).toBe(ContentEncoding.Base64);
    expect(Buffer.from(result.data, "base64").equals(bytes)).toBe(true);
  });

  it("honors an explicit base64 encoding request for text", async () => {
    await writeFile(join(root, "a.txt"), "hi", "utf-8");
    const result = await readResource(uriIn(root, "a.txt"), [root], ContentEncoding.Base64);
    expect(result.encoding).toBe(ContentEncoding.Base64);
    expect(Buffer.from(result.data, "base64").toString("utf-8")).toBe("hi");
  });

  it("rejects an unsupported encoding with InvalidParams", async () => {
    await writeFile(join(root, "a.txt"), "hi", "utf-8");
    const err = await expectResourceError(
      readResource(uriIn(root, "a.txt"), [root], "latin1" as ContentEncoding),
    );
    expect(err.code).toBe(JsonRpcErrorCodes.InvalidParams);
  });

  it("throws NotFound for a missing file", async () => {
    const err = await expectResourceError(readResource(uriIn(root, "nope.txt"), [root]));
    expect(err.code).toBe(AhpErrorCodes.NotFound);
  });

  it("throws NotFound when the target is a directory", async () => {
    await mkdir(join(root, "sub"));
    const err = await expectResourceError(readResource(uriIn(root, "sub"), [root]));
    expect(err.code).toBe(AhpErrorCodes.NotFound);
  });

  it("throws PermissionDenied for a path outside the roots (traversal)", async () => {
    await writeFile(join(outside, "secret.txt"), "nope", "utf-8");
    const err = await expectResourceError(readResource(uriIn(outside, "secret.txt"), [root]));
    expect(err.code).toBe(AhpErrorCodes.PermissionDenied);
  });

  it("throws PermissionDenied when roots is empty", async () => {
    await writeFile(join(root, "a.txt"), "hi", "utf-8");
    const err = await expectResourceError(readResource(uriIn(root, "a.txt"), []));
    expect(err.code).toBe(AhpErrorCodes.PermissionDenied);
  });

  it("throws PermissionDenied for a symlink inside the root that escapes it", async () => {
    await writeFile(join(outside, "secret.txt"), "leak", "utf-8");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    } catch {
      // Symlink creation can fail without privilege on Windows; skip in that case.
      return;
    }
    const err = await expectResourceError(readResource(uriIn(root, "link.txt"), [root]));
    expect(err.code).toBe(AhpErrorCodes.PermissionDenied);
  });
});

describe("listResource", () => {
  it("lists files and directories with correct types", async () => {
    await writeFile(join(root, "a.txt"), "x", "utf-8");
    await mkdir(join(root, "sub"));
    const result = await listResource(uriIn(root), [root]);
    const byName = new Map(result.entries.map((e) => [e.name, e.type]));
    expect(byName.get("a.txt")).toBe("file");
    expect(byName.get("sub")).toBe("directory");
  });

  it("throws NotFound for a missing directory", async () => {
    const err = await expectResourceError(listResource(uriIn(root, "missing"), [root]));
    expect(err.code).toBe(AhpErrorCodes.NotFound);
  });

  it("throws NotFound when the target is a file, not a directory", async () => {
    await writeFile(join(root, "a.txt"), "x", "utf-8");
    const err = await expectResourceError(listResource(uriIn(root, "a.txt"), [root]));
    expect(err.code).toBe(AhpErrorCodes.NotFound);
  });

  it("throws PermissionDenied for a directory outside the roots", async () => {
    const err = await expectResourceError(listResource(uriIn(outside), [root]));
    expect(err.code).toBe(AhpErrorCodes.PermissionDenied);
  });
});
