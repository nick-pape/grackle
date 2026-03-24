/**
 * UT-1 / UT-2: Verify that both @grackle-ai/server and @grackle-ai/cli
 * publish a `pnpm.onlyBuiltDependencies` field that includes "better-sqlite3",
 * so pnpm v8+ users get the native binding built automatically on install.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPackageJson(packageDir: string): Record<string, unknown> {
  const pkgPath = resolve(__dirname, packageDir, "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
}

describe("pnpm onlyBuiltDependencies policy", () => {
  it("UT-1: @grackle-ai/database/package.json includes better-sqlite3 in pnpm.onlyBuiltDependencies", () => {
    // __dirname is packages/core/src — two levels up reaches packages/, then into database
    const pkg = readPackageJson("../../database");
    expect(pkg.name).toBe("@grackle-ai/database");

    const pnpmConfig = pkg.pnpm as Record<string, unknown> | undefined;
    expect(pnpmConfig, "pnpm section must exist in package.json").toBeDefined();

    const onlyBuilt = pnpmConfig?.onlyBuiltDependencies as string[] | undefined;
    expect(
      Array.isArray(onlyBuilt),
      "pnpm.onlyBuiltDependencies must be an array",
    ).toBe(true);
    expect(onlyBuilt).toContain("better-sqlite3");
  });

  it("UT-2: @grackle-ai/cli/package.json includes better-sqlite3 in pnpm.onlyBuiltDependencies", () => {
    // __dirname is packages/server/src — two levels up reaches packages/, then into cli
    const pkg = readPackageJson("../../cli");
    expect(pkg.name).toBe("@grackle-ai/cli");

    const pnpmConfig = pkg.pnpm as Record<string, unknown> | undefined;
    expect(pnpmConfig, "pnpm section must exist in package.json").toBeDefined();

    const onlyBuilt = pnpmConfig?.onlyBuiltDependencies as string[] | undefined;
    expect(
      Array.isArray(onlyBuilt),
      "pnpm.onlyBuiltDependencies must be an array",
    ).toBe(true);
    expect(onlyBuilt).toContain("better-sqlite3");
  });
});
