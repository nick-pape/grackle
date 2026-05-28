import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileClientIdStore, InMemoryClientIdStore } from "./client-id-store.js";

describe("InMemoryClientIdStore", () => {
  it("returns undefined for an unknown key", async () => {
    const store = new InMemoryClientIdStore();
    expect(await store.load("missing")).toBeUndefined();
  });

  it("roundtrips save -> load", async () => {
    const store = new InMemoryClientIdStore();
    await store.save("k", "client-1");
    expect(await store.load("k")).toBe("client-1");
  });

  it("save() overwrites the prior value", async () => {
    const store = new InMemoryClientIdStore();
    await store.save("k", "client-1");
    await store.save("k", "client-2");
    expect(await store.load("k")).toBe("client-2");
  });

  it("isolates entries by key", async () => {
    const store = new InMemoryClientIdStore();
    await store.save("a", "x");
    await store.save("b", "y");
    expect(await store.load("a")).toBe("x");
    expect(await store.load("b")).toBe("y");
  });
});

describe("FileClientIdStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ahp-transport-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when no file exists", async () => {
    const store = new FileClientIdStore(dir);
    expect(await store.load("missing")).toBeUndefined();
  });

  it("roundtrips save -> load", async () => {
    const store = new FileClientIdStore(dir);
    await store.save("host-1", "client-abc");
    expect(await store.load("host-1")).toBe("client-abc");
  });

  it("survives across instances pointed at the same root", async () => {
    const writer = new FileClientIdStore(dir);
    await writer.save("host-1", "client-xyz");
    const reader = new FileClientIdStore(dir);
    expect(await reader.load("host-1")).toBe("client-xyz");
  });

  it("save() is atomic: the target file replaces atomically (no partial state)", async () => {
    const store = new FileClientIdStore(dir);
    await store.save("k", "first");
    await store.save("k", "second");
    expect(await store.load("k")).toBe("second");
    // Confirm no leftover .tmp files were left behind in the success path.
    const files = await readdir(dir);
    const tmps = files.filter((f) => f.includes(".tmp"));
    expect(tmps).toEqual([]);
  });

  it("treats an empty file as 'no stored id'", async () => {
    const store = new FileClientIdStore(dir);
    // Simulate a zero-byte file from a hypothetical pre-rename crash that
    // somehow left an empty target file. The store should not return ''.
    await writeFile(join(dir, "k.clientid"), "", "utf8");
    expect(await store.load("k")).toBeUndefined();
  });

  it("strips surrounding whitespace on load", async () => {
    const store = new FileClientIdStore(dir);
    await writeFile(join(dir, "k.clientid"), "  client-1\n", "utf8");
    expect(await store.load("k")).toBe("client-1");
  });

  it("creates the root directory on demand", async () => {
    const nested = join(dir, "nested", "deeper");
    const store = new FileClientIdStore(nested);
    await store.save("k", "v");
    expect(await readFile(join(nested, "k.clientid"), "utf8")).toBe("v");
  });

  it("URL-encodes unsafe characters in the key", async () => {
    const store = new FileClientIdStore(dir);
    await store.save("host/with:slashes", "v");
    const files = await readdir(dir);
    // Slash → %2f, colon → %3a
    expect(files).toContain("host%2fwith%3aslashes.clientid");
  });
});
