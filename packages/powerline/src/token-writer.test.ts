import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve, normalize, dirname } from "node:path";

/**
 * Compute a platform-appropriate fake home directory.
 * On Windows, resolve() needs a drive letter to produce an absolute path.
 */
const FAKE_HOME: string = resolve("/fakehome/testuser");

// Mock dependencies before importing
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isUnderHome, writeTokens, FileSystem } from "./token-writer.js";
import { logger } from "./logger.js";

/** Create a fake FileSystem with sensible defaults for testing. */
function createFakeFileSystem(overrides?: Partial<FileSystem>): FileSystem {
  return {
    realpathSync: (p: string) => p,
    existsSync: () => true,
    realpath: async (p: string) => p,
    mkdir: async () => {},
    writeFile: async () => {},
    homedir: () => FAKE_HOME,
    ...overrides,
  };
}

describe("isUnderHome", () => {
  it("returns true for paths under home", () => {
    expect(isUnderHome("/home/user/.config/file.txt", "/home/user")).toBe(true);
  });

  it("returns true for deeply nested paths", () => {
    expect(isUnderHome("/home/user/a/b/c/d", "/home/user")).toBe(true);
  });

  it("returns false for paths outside home", () => {
    expect(isUnderHome("/etc/passwd", "/home/user")).toBe(false);
  });

  it("returns false for sibling directories", () => {
    expect(isUnderHome("/home/other/.config", "/home/user")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isUnderHome("/HOME/USER/file.txt", "/home/user")).toBe(true);
    expect(isUnderHome("/Home/User/File.txt", "/home/user")).toBe(true);
  });

  it("handles prefix-collision correctly", () => {
    // /home/username should NOT be under /home/user
    expect(isUnderHome("/home/username/.config", "/home/user")).toBe(false);
  });

  it("handles home with trailing separator", () => {
    expect(isUnderHome("/home/user/file.txt", "/home/user/")).toBe(true);
  });

  it("returns true when path equals home exactly", () => {
    expect(isUnderHome("/home/user", "/home/user")).toBe(true);
  });
});

describe("writeTokens", () => {
  /** Compute a path under the fake home so resolve() produces consistent results. */
  function homeFile(...segments: string[]): string {
    return resolve(FAKE_HOME, ...segments);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets env var for env_var type tokens", async () => {
    const fs = createFakeFileSystem();

    await writeTokens([
      { name: "test", type: "env_var", envVar: "MY_TOKEN", filePath: "", value: "secret123" },
    ], fs);

    expect(process.env.MY_TOKEN).toBe("secret123");
    // Clean up
    delete process.env.MY_TOKEN;
  });

  it("writes file under home directory", async () => {
    const filePath = homeFile(".config", "token");
    const mkdirSpy = vi.fn(async () => {});
    const writeFileSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ mkdir: mkdirSpy, writeFile: writeFileSpy });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath, value: "filedata" },
    ], fs);

    expect(mkdirSpy).toHaveBeenCalledWith(dirname(filePath), { recursive: true });
    expect(writeFileSpy).toHaveBeenCalledWith(filePath, "filedata", { mode: 0o600 });
  });

  it("refuses to write files outside home directory", async () => {
    // Use a path that resolve() will produce as absolute but outside FAKE_HOME
    const outsidePath = resolve("/etc/passwd");
    const writeFileSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ writeFile: writeFileSpy });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath: outsidePath, value: "bad" },
    ], fs);

    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("creates parent directories with recursive option", async () => {
    const filePath = homeFile("deep", "nested", "dir", "file");
    const mkdirSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ mkdir: mkdirSpy });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath, value: "data" },
    ], fs);

    expect(mkdirSpy).toHaveBeenCalledWith(dirname(filePath), { recursive: true });
  });

  it("resolves ~ to home directory", async () => {
    const writeFileSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ writeFile: writeFileSpy });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath: "~/.config/token", value: "data" },
    ], fs);

    expect(writeFileSpy).toHaveBeenCalled();
    // The resolved path should contain the fake home directory
    const writtenPath = writeFileSpy.mock.calls[0][0] as string;
    expect(normalize(writtenPath)).toContain("testuser");
  });

  it("detects symlink traversal and refuses write", async () => {
    const filePath = homeFile("link", "file");
    const mkdirSpy = vi.fn(async () => {});
    const writeFileSpy = vi.fn(async () => {});
    // realpath resolves the nearest existing ancestor to a path outside home
    const fs = createFakeFileSystem({
      mkdir: mkdirSpy,
      writeFile: writeFileSpy,
      realpath: async () => resolve("/etc/evil"),
    });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath, value: "data" },
    ], fs);

    // When symlink traversal is detected, no directories should be created and no file written
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("writes file with mode 0o600", async () => {
    const filePath = homeFile(".token");
    const writeFileSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ writeFile: writeFileSpy });

    await writeTokens([
      { name: "test", type: "file", envVar: "", filePath, value: "secret" },
    ], fs);

    expect(writeFileSpy).toHaveBeenCalledWith(filePath, "secret", { mode: 0o600 });
  });

  it("continues processing after file write failure", async () => {
    const failPath = homeFile(".fail-token");
    const successPath = homeFile(".success-token");
    const writeFileSpy = vi.fn(async () => {});
    writeFileSpy.mockRejectedValueOnce(new Error("EROFS: read-only file system"));
    const fs = createFakeFileSystem({ writeFile: writeFileSpy });

    await writeTokens([
      { name: "fail", type: "file", envVar: "", filePath: failPath, value: "data1" },
      { name: "success", type: "file", envVar: "", filePath: successPath, value: "data2" },
    ], fs);

    expect(logger.warn).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledTimes(2);
    expect(writeFileSpy).toHaveBeenLastCalledWith(successPath, "data2", { mode: 0o600 });
  });

  it("continues processing after mkdir failure", async () => {
    const failPath = homeFile("readonly", "token");
    const successPath = homeFile(".ok-token");
    const mkdirSpy = vi.fn(async () => {});
    mkdirSpy.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const writeFileSpy = vi.fn(async () => {});
    const fs = createFakeFileSystem({ mkdir: mkdirSpy, writeFile: writeFileSpy });

    await writeTokens([
      { name: "fail", type: "file", envVar: "", filePath: failPath, value: "data1" },
      { name: "success", type: "file", envVar: "", filePath: successPath, value: "data2" },
    ], fs);

    expect(logger.warn).toHaveBeenCalled();
    // The second token should still be processed
    expect(writeFileSpy).toHaveBeenCalledWith(successPath, "data2", { mode: 0o600 });
  });

  it("env var tokens are unaffected by file write failures", async () => {
    const filePath = homeFile(".broken");
    const writeFileSpy = vi.fn(async () => {});
    writeFileSpy.mockRejectedValueOnce(new Error("EROFS"));
    const fs = createFakeFileSystem({ writeFile: writeFileSpy });

    await writeTokens([
      { name: "file-token", type: "file", envVar: "", filePath, value: "data" },
      { name: "env-token", type: "env_var", envVar: "MY_RESILIENT_VAR", filePath: "", value: "works" },
    ], fs);

    expect(process.env.MY_RESILIENT_VAR).toBe("works");
    delete process.env.MY_RESILIENT_VAR;
  });
});
