/**
 * Catalog of Grackle's built-in UI components available to agent-authored GenUX
 * (#1271). These are the curated, context-free components the sandbox React
 * runtime (`@grackle-ai/web-components` `mcp-runtime`) exposes in scope, so an
 * agent can compose them in JSX via `component_show` / `component_register`.
 *
 * This is metadata only (no React). `component_search` surfaces these alongside
 * agent-authored components so agents discover an existing building block before
 * hand-rolling one. The `name`s MUST stay a subset of the runtime's component
 * scope (enforced by a web-components test); `propsSchema` documents the *data*
 * props an agent passes (callbacks are expressed in JSX, not as JSON props).
 */

/** A Grackle-provided component the GenUX runtime can render. */
export interface BuiltinComponent {
  /** Component name, as referenced in agent JSX (matches the runtime scope key). */
  name: string;
  /** One-line description of what the component is for. */
  description: string;
  /** JSON Schema (stringified) describing the component's data props. */
  propsSchema: string;
  /** A short JSX usage example. */
  example: string;
}

/** Catalog of built-in components exposed to agent JSX (the runtime's curated scope). */
export const BUILTIN_COMPONENTS: readonly BuiltinComponent[] = [
  {
    name: "Button",
    description: "Clickable action button with visual variants and sizes.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        variant: { type: "string", enum: ["primary", "danger", "outline", "ghost"], description: "Visual style (default primary)." },
        size: { type: "string", enum: ["sm", "md", "lg"], description: "Button size (default md)." },
        disabled: { type: "boolean" },
      },
      additionalProperties: true,
    }),
    example: '<Button variant="primary">Deploy</Button>',
  },
  {
    name: "SplitButton",
    description: "Primary action button with a dropdown of secondary options.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        label: { type: "string", description: "Main action label." },
        variant: { type: "string", enum: ["primary", "danger", "outline", "ghost"] },
        size: { type: "string", enum: ["sm", "md", "lg"] },
        options: {
          type: "array",
          description: "Secondary options.",
          items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] },
        },
      },
      required: ["label", "options"],
      additionalProperties: true,
    }),
    example: '<SplitButton label="Save" onClick={() => {}} options={[{ label: "Save as draft", onClick: () => {} }]} />',
  },
  {
    name: "Callout",
    description: "Inline message box for info, success, warning, or error notes.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        variant: { type: "string", enum: ["success", "error", "warning", "info"], description: "Severity (default info)." },
        dismissible: { type: "boolean" },
      },
      additionalProperties: true,
    }),
    example: '<Callout variant="warning">Low disk space.</Callout>',
  },
  {
    name: "Spinner",
    description: "Loading/progress spinner.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        size: { type: "string", enum: ["sm", "md", "lg", "xl"], description: "Spinner size (default md)." },
        label: { type: "string", description: "Accessible label (default 'Loading')." },
      },
      additionalProperties: true,
    }),
    example: "<Spinner size=\"lg\" label=\"Building…\" />",
  },
  {
    name: "Skeleton",
    description: "Rectangular or circular loading placeholder block.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        width: { type: "string", description: "CSS width (default 100%)." },
        height: { type: "string", description: "CSS height (default 1rem)." },
        borderRadius: { type: "string" },
        variant: { type: "string", enum: ["rectangular", "circular"] },
      },
      additionalProperties: true,
    }),
    example: '<Skeleton width="200px" height="2rem" />',
  },
  {
    name: "SkeletonText",
    description: "Multi-line text loading placeholder.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        lines: { type: "integer", minimum: 1, description: "Number of lines (default 3)." },
        lastLineWidth: { type: "string", description: "Width of the last line (default 60%)." },
        lineHeight: { type: "string" },
        gap: { type: "string" },
      },
      additionalProperties: true,
    }),
    example: "<SkeletonText lines={4} />",
  },
  {
    name: "SkeletonCard",
    description: "Card-shaped loading placeholder (title + body lines).",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        lines: { type: "integer", minimum: 1, description: "Body text lines (default 2)." },
      },
      additionalProperties: true,
    }),
    example: "<SkeletonCard lines={3} />",
  },
  {
    name: "Tooltip",
    description: "Hover tooltip wrapping its children.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        text: { type: "string", description: "Tooltip text." },
        placement: { type: "string", enum: ["top", "bottom", "left", "right"], description: "Default top." },
        delayMs: { type: "integer", minimum: 0 },
      },
      required: ["text"],
      additionalProperties: true,
    }),
    example: '<Tooltip text="Copy to clipboard"><Button>Copy</Button></Tooltip>',
  },
  {
    name: "CopyButton",
    description: "Button that copies the given text to the clipboard.",
    propsSchema: JSON.stringify({
      type: "object",
      properties: {
        text: { type: "string", description: "Text to copy." },
      },
      required: ["text"],
      additionalProperties: true,
    }),
    example: '<CopyButton text="npm install grackle" />',
  },
];
