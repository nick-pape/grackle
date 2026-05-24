/**
 * Curated, context-free presentational components exposed to agent JSX in the
 * GenUX runtime (#1268). Kept in its own module (no `main()` side effect) so the
 * built-in catalog drift test can import the scope without booting the runtime.
 *
 * Phase 0 keeps this a small, safe set — components that need router or
 * `useGrackle()` context are excluded. The discoverable catalog of these lives in
 * `@grackle-ai/common` `BUILTIN_COMPONENTS` (#1271); a test asserts that catalog
 * stays a subset of these names.
 */
import {
  Button, SplitButton, Callout, Spinner,
  Skeleton, SkeletonText, SkeletonCard, Tooltip, CopyButton,
} from "../index.js";

/** Component name → component, injected into the react-live evaluation scope. */
export const COMPONENT_SCOPE: Readonly<Record<string, unknown>> = {
  Button, SplitButton, Callout, Spinner,
  Skeleton, SkeletonText, SkeletonCard, Tooltip, CopyButton,
};

/** Names of the curated components available to agent JSX (the catalog must stay a subset). */
export const CURATED_COMPONENT_NAMES: readonly string[] = Object.keys(COMPONENT_SCOPE);
