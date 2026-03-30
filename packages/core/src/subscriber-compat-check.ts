/**
 * Compile-time compatibility guard.
 *
 * Verifies that plugin-sdk's PluginContext is a structural superset of
 * core's PluginContext, so subscriber factories that accept core's narrow
 * context also accept the full plugin-sdk context.
 *
 * These are pure type-level assertions — no runtime code. If the types
 * drift, `rush build` will fail with a type error here.
 *
 * @module
 */

import type { PluginContext as SdkContext, Disposable as SdkDisposable } from "@grackle-ai/plugin-sdk";
import type { PluginContext as CoreContext, Disposable as CoreDisposable } from "./subscriber-types.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time assertion only
type AssertContextCompat = SdkContext extends CoreContext ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time assertion only
type AssertDisposableCompat = SdkDisposable extends CoreDisposable ? true : never;
