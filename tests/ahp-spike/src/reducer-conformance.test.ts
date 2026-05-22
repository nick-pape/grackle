/**
 * Vendoring fidelity check: run the AHP project's OWN reducer conformance corpus
 * (`vendor/ahp/test-cases/reducers/*.json`) through the vendored reducers. If
 * these pass, our vendored copy (including the `const enum` → `enum` conversion)
 * faithfully reproduces upstream reducer behavior, so the replay test in
 * `mapper.test.ts` is standing on solid ground.
 *
 * Mirrors the harness from upstream `types/reducers.test.ts`.
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rootReducer, sessionReducer, terminalReducer, changesetReducer } from "./vendor/ahp/reducers.js";

interface Fixture {
  description: string;
  reducer: "root" | "session" | "terminal" | "changeset";
  initial: unknown;
  actions: unknown[];
  expected: unknown;
}

/** Upstream fixtures use JSON `null` for absent optional fields; reducers use `undefined`. */
function nullToUndefined<T>(value: T): T {
  if (value === null) {
    return undefined as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(nullToUndefined) as unknown as T;
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = nullToUndefined(v);
    }
    return result as T;
  }
  return value;
}

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "vendor", "ahp", "test-cases", "reducers");
const fixtures: Fixture[] = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => nullToUndefined(JSON.parse(readFileSync(resolve(fixtureDir, f), "utf-8"))) as Fixture);

// Upstream fixtures were generated with Date.now() pinned to 9999.
let realNow: typeof Date.now;
beforeEach(() => {
  realNow = Date.now;
  Date.now = () => 9999;
});
afterEach(() => {
  Date.now = realNow;
});

describe("vendored AHP reducer conformance", () => {
  it("loaded the upstream corpus", () => {
    assert.ok(fixtures.length > 0, "expected at least one reducer fixture");
  });

  // Several fixtures intentionally exercise unknown-action no-ops; the reducer's
  // softAssertNever falls back to console.warn (→ stderr → Rush "warnings").
  // Pass a no-op logger so the conformance run stays clean.
  const noLog = (): void => {};

  for (const fixture of fixtures) {
    it(`${fixture.reducer}: ${fixture.description}`, () => {
      let state = fixture.initial;
      for (const action of fixture.actions) {
        switch (fixture.reducer) {
          case "root":
            state = rootReducer(state as never, action as never, noLog);
            break;
          case "terminal":
            state = terminalReducer(state as never, action as never, noLog);
            break;
          case "changeset":
            state = changesetReducer(state as never, action as never, noLog);
            break;
          default:
            state = sessionReducer(state as never, action as never, noLog);
            break;
        }
      }
      assert.deepStrictEqual(state, fixture.expected);
    });
  }
});
