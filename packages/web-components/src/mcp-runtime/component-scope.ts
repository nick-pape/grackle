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
// Import the curated components from their direct module files (NOT the package
// barrel `../index.js`): the barrel transitively pulls DagView -> @dagrejs/dagre,
// whose ESM entry vitest can't resolve, which broke this module's test. Direct
// imports keep the runtime scope (and its drift test) dependency-light.
import { Button } from "../components/display/Button.js";
import { SplitButton } from "../components/display/SplitButton.js";
import { Spinner } from "../components/display/Spinner.js";
import { Skeleton, SkeletonText, SkeletonCard } from "../components/display/Skeleton.js";
import { Tooltip } from "../components/display/Tooltip.js";
import { CopyButton } from "../components/display/CopyButton.js";
import { Callout } from "../components/notifications/Callout.js";

/** Component name → component, injected into the react-live evaluation scope. */
export const COMPONENT_SCOPE: Readonly<Record<string, unknown>> = {
  Button,
  SplitButton,
  Callout,
  Spinner,
  Skeleton,
  SkeletonText,
  SkeletonCard,
  Tooltip,
  CopyButton,
};

/** Names of the curated components available to agent JSX (the catalog must stay a subset). */
export const CURATED_COMPONENT_NAMES: readonly string[] = Object.keys(COMPONENT_SCOPE);
