/**
 * Compile-time compatibility guard.
 *
 * Verifies that plugin-sdk's PluginContext is a structural superset of
 * core's PluginContext, so subscriber factories that accept core's narrow
 * context also accept the full plugin-sdk context.
 *
 * This file is included in the TypeScript build (not a .test.ts file).
 * If the types drift, `rush build` will fail with a type error here.
 *
 * @module
 */

import type { PluginContext as SdkContext, Disposable as SdkDisposable } from "@grackle-ai/plugin-sdk";
import type { PluginContext as CoreContext, Disposable as CoreDisposable } from "./subscriber-types.js";

/** Verify sdk PluginContext is assignable to core PluginContext. */
function _assertContextCompat(_sdk: SdkContext): CoreContext { return _sdk; }

/** Verify sdk Disposable is assignable to core Disposable. */
function _assertDisposableCompat(_sdk: SdkDisposable): CoreDisposable { return _sdk; }

// Suppress unused warnings — these functions exist solely for the type check.
// eslint-disable-next-line no-void
void (_assertContextCompat as unknown);
// eslint-disable-next-line no-void
void (_assertDisposableCompat as unknown);
