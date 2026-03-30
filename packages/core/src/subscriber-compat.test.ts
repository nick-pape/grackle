/**
 * Compile-time compatibility test.
 *
 * Verifies that plugin-sdk's PluginContext is a structural superset of
 * core's PluginContext, so subscriber factories that accept core's narrow
 * context also accept the full plugin-sdk context.
 *
 * If these types drift, TypeScript will error at compile time.
 */
import { describe, it, expect } from "vitest";
import type { PluginContext as SdkContext, Disposable as SdkDisposable } from "@grackle-ai/plugin-sdk";
import type { PluginContext as CoreContext, Disposable as CoreDisposable } from "./subscriber-types.js";

describe("plugin-sdk / core type compatibility", () => {
  it("sdk PluginContext is assignable to core PluginContext", () => {
    // This is a compile-time check — if it compiles, the test passes.
    // The assignment verifies structural subtyping: sdk context (wider)
    // is assignable to core context (narrower).
    const assignable = (_core: CoreContext, _sdk: SdkContext): boolean => {
      const _: CoreContext = _sdk;
      void _;
      return true;
    };
    expect(assignable).toBeDefined();
  });

  it("sdk Disposable is assignable to core Disposable", () => {
    const assignable = (_core: CoreDisposable, _sdk: SdkDisposable): boolean => {
      const _: CoreDisposable = _sdk;
      void _;
      return true;
    };
    expect(assignable).toBeDefined();
  });
});
