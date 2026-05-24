/**
 * Catalog of Grackle's built-in UI components available to agent-authored GenUX
 * (#1271). These are the curated, context-free components the sandbox React
 * runtime (`@grackle-ai/web-components` `mcp-runtime`) exposes in scope, so an
 * agent can compose them in JSX via `component_show` / `component_register`.
 *
 * This is metadata only (no React). `component_search` surfaces these alongside
 * agent-authored components so agents discover an existing building block before
 * hand-rolling one. The `name`s MUST stay a subset of the runtime's component
 * scope (enforced by a web-components test); each `propsSchema` is *derived* from
 * the component's zod schema in `builtin-component-schemas.ts` (the single source
 * of truth shared with the component's prop types) — never hand-authored.
 */
import { z } from "zod";
import { BUILTIN_COMPONENT_SCHEMAS, type BuiltinComponentName } from "./builtin-component-schemas.js";

/** A Grackle-provided component the GenUX runtime can render. */
export interface BuiltinComponent {
  /** Component name, as referenced in agent JSX (matches the runtime scope key). */
  name: string;
  /** One-line description of what the component is for. */
  description: string;
  /** JSON Schema (stringified) describing the component's data props, derived from its zod schema. */
  propsSchema: string;
  /** A short JSX usage example. */
  example: string;
}

/** Human-facing description + usage example for each built-in (paired with its zod schema by name). */
const BUILTIN_COMPONENT_DOCS: Record<BuiltinComponentName, { description: string; example: string }> = {
  Button: {
    description: "Clickable action button with visual variants and sizes.",
    example: '<Button variant="primary">Deploy</Button>',
  },
  SplitButton: {
    description: "Primary action button with a dropdown of secondary options.",
    example: '<SplitButton label="Save" onClick={() => {}} options={[{ label: "Save as draft", onClick: () => {} }]} />',
  },
  Callout: {
    description: "Inline message box for info, success, warning, or error notes.",
    example: '<Callout variant="warning">Low disk space.</Callout>',
  },
  Spinner: {
    description: "Loading/progress spinner.",
    example: '<Spinner size="lg" label="Building…" />',
  },
  Skeleton: {
    description: "Rectangular or circular loading placeholder block.",
    example: '<Skeleton width="200px" height="2rem" />',
  },
  SkeletonText: {
    description: "Multi-line text loading placeholder.",
    example: "<SkeletonText lines={4} />",
  },
  SkeletonCard: {
    description: "Card-shaped loading placeholder (title + body lines).",
    example: "<SkeletonCard lines={3} />",
  },
  Tooltip: {
    description: "Hover tooltip wrapping its children.",
    example: '<Tooltip text="Copy to clipboard"><Button>Copy</Button></Tooltip>',
  },
  CopyButton: {
    description: "Button that copies the given text to the clipboard.",
    example: '<CopyButton text="npm install grackle" />',
  },
};

/**
 * Built-in component name → its data-props JSON Schema (an object, derived from
 * the zod schema). Importable for callers that need the raw JSON Schema — e.g.
 * promote-to-tool (#1272), where it becomes a render tool's `inputSchema`.
 */
export const BUILTIN_COMPONENT_JSON_SCHEMAS: Readonly<Record<BuiltinComponentName, object>> = Object.fromEntries(
  (Object.entries(BUILTIN_COMPONENT_SCHEMAS) as [BuiltinComponentName, z.ZodType][]).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema),
  ]),
) as Record<BuiltinComponentName, object>;

/** Catalog of built-in components exposed to agent JSX (the runtime's curated scope). */
export const BUILTIN_COMPONENTS: readonly BuiltinComponent[] = (
  Object.keys(BUILTIN_COMPONENT_SCHEMAS) as BuiltinComponentName[]
).map((name) => ({
  name,
  description: BUILTIN_COMPONENT_DOCS[name].description,
  propsSchema: JSON.stringify(BUILTIN_COMPONENT_JSON_SCHEMAS[name]),
  example: BUILTIN_COMPONENT_DOCS[name].example,
}));
