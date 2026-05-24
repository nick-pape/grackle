/**
 * Zod schemas for the *data props* of Grackle's built-in GenUX components (#1271).
 *
 * These zod schemas are the single source of truth for both:
 *  - the components' prop types — `@grackle-ai/web-components` imports the inferred
 *    `…BuiltinProps` types so a schema/component drift is a compile error, and
 *  - the built-in catalog's JSON Schema — `builtin-components.ts` derives it via
 *    `z.toJSONSchema()` instead of hand-authoring it (see {@link BUILTIN_COMPONENT_SCHEMAS}).
 *
 * Only *data* props are modelled: callbacks (`onClick`), `children`, refs, and
 * styling hooks (`className`, `data-testid`) are expressed in JSX, not as JSON
 * props, so the components add those on top of the inferred types.
 */
import { z } from "zod";

/* eslint-disable @rushstack/typedef-var -- zod schema types are inferred from z.object()/z.enum(); annotating them by hand defeats the inference these schemas exist to provide. */

// ── Shared enums (single source of truth for the variant/size unions) ──

/** Visual variant shared by Button and SplitButton. */
export const buttonVariantSchema = z.enum(["primary", "danger", "outline", "ghost"]);
/** Visual variant shared by Button and SplitButton. */
export type ButtonVariant = z.infer<typeof buttonVariantSchema>;

/** Size shared by Button and SplitButton. */
export const buttonSizeSchema = z.enum(["sm", "md", "lg"]);
/** Size shared by Button and SplitButton. */
export type ButtonSize = z.infer<typeof buttonSizeSchema>;

/** Spinner size. */
export const spinnerSizeSchema = z.enum(["sm", "md", "lg", "xl"]);
/** Spinner size. */
export type SpinnerSize = z.infer<typeof spinnerSizeSchema>;

/** Skeleton shape variant. */
export const skeletonVariantSchema = z.enum(["rectangular", "circular"]);
/** Skeleton shape variant. */
export type SkeletonVariant = z.infer<typeof skeletonVariantSchema>;

/** Callout severity. */
export const calloutVariantSchema = z.enum(["success", "error", "warning", "info"]);
/** Callout severity. */
export type CalloutVariant = z.infer<typeof calloutVariantSchema>;

/** Tooltip placement relative to its anchor. */
export const tooltipPlacementSchema = z.enum(["top", "bottom", "left", "right"]);
/** Tooltip placement relative to its anchor. */
export type TooltipPlacement = z.infer<typeof tooltipPlacementSchema>;

// ── Per-component data-prop schemas ──

/** Data props for the `Button` built-in. */
export const buttonPropsSchema = z.object({
  variant: buttonVariantSchema.optional().describe("Visual style (default primary)."),
  size: buttonSizeSchema.optional().describe("Button size (default md)."),
  disabled: z.boolean().optional(),
});
/** Data props for the `Button` built-in. */
export type ButtonBuiltinProps = z.infer<typeof buttonPropsSchema>;

/** A single option in a `SplitButton` dropdown (data shape; the `onClick` callback is added by the component). */
export const splitButtonOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

/** Data props for the `SplitButton` built-in. */
export const splitButtonPropsSchema = z.object({
  label: z.string().describe("Main action label."),
  variant: buttonVariantSchema.optional(),
  size: buttonSizeSchema.optional(),
  options: z.array(splitButtonOptionSchema).describe("Secondary options shown in the dropdown."),
});
/** Data props for the `SplitButton` built-in. */
export type SplitButtonBuiltinProps = z.infer<typeof splitButtonPropsSchema>;

/** Data props for the `Callout` built-in. */
export const calloutPropsSchema = z.object({
  variant: calloutVariantSchema.optional().describe("Severity (default info)."),
  dismissible: z.boolean().optional(),
});
/** Data props for the `Callout` built-in. */
export type CalloutBuiltinProps = z.infer<typeof calloutPropsSchema>;

/** Data props for the `Spinner` built-in. */
export const spinnerPropsSchema = z.object({
  size: spinnerSizeSchema.optional().describe("Spinner size (default md)."),
  label: z.string().optional().describe("Accessible label (default 'Loading')."),
  liveRegion: z.boolean().optional().describe("Announce status to screen readers via aria-live."),
});
/** Data props for the `Spinner` built-in. */
export type SpinnerBuiltinProps = z.infer<typeof spinnerPropsSchema>;

/** Data props for the `Skeleton` built-in. */
export const skeletonPropsSchema = z.object({
  width: z.string().optional().describe("CSS width (default 100%)."),
  height: z.string().optional().describe("CSS height (default 1rem)."),
  borderRadius: z.string().optional(),
  variant: skeletonVariantSchema.optional(),
});
/** Data props for the `Skeleton` built-in. */
export type SkeletonBuiltinProps = z.infer<typeof skeletonPropsSchema>;

/** Data props for the `SkeletonText` built-in. */
export const skeletonTextPropsSchema = z.object({
  lines: z.int().min(1).optional().describe("Number of lines (default 3)."),
  lastLineWidth: z.string().optional().describe("Width of the last line (default 60%)."),
  lineHeight: z.string().optional(),
  gap: z.string().optional(),
});
/** Data props for the `SkeletonText` built-in. */
export type SkeletonTextBuiltinProps = z.infer<typeof skeletonTextPropsSchema>;

/** Data props for the `SkeletonCard` built-in. */
export const skeletonCardPropsSchema = z.object({
  lines: z.int().min(1).optional().describe("Body text lines (default 2)."),
});
/** Data props for the `SkeletonCard` built-in. */
export type SkeletonCardBuiltinProps = z.infer<typeof skeletonCardPropsSchema>;

/** Data props for the `Tooltip` built-in. */
export const tooltipPropsSchema = z.object({
  text: z.string().describe("Tooltip text."),
  placement: tooltipPlacementSchema.optional().describe("Placement relative to the anchor (default top)."),
  delayMs: z.int().min(0).optional(),
});
/** Data props for the `Tooltip` built-in. */
export type TooltipBuiltinProps = z.infer<typeof tooltipPropsSchema>;

/** Data props for the `CopyButton` built-in. */
export const copyButtonPropsSchema = z.object({
  text: z.string().describe("Text to copy to the clipboard."),
});
/** Data props for the `CopyButton` built-in. */
export type CopyButtonBuiltinProps = z.infer<typeof copyButtonPropsSchema>;

/**
 * Built-in component name → its zod data-prop schema. The keys MUST match the
 * runtime component scope and the {@link BUILTIN_COMPONENTS} catalog (enforced by
 * tests). Reused by `builtin-components.ts` to derive the JSON Schema catalog,
 * and available for promote-to-tool (#1272) where a schema becomes a tool's
 * `inputSchema`.
 */
export const BUILTIN_COMPONENT_SCHEMAS = {
  Button: buttonPropsSchema,
  SplitButton: splitButtonPropsSchema,
  Callout: calloutPropsSchema,
  Spinner: spinnerPropsSchema,
  Skeleton: skeletonPropsSchema,
  SkeletonText: skeletonTextPropsSchema,
  SkeletonCard: skeletonCardPropsSchema,
  Tooltip: tooltipPropsSchema,
  CopyButton: copyButtonPropsSchema,
} as const satisfies Record<string, z.ZodType>;

/** Name of a built-in component (a key of {@link BUILTIN_COMPONENT_SCHEMAS}). */
export type BuiltinComponentName = keyof typeof BUILTIN_COMPONENT_SCHEMAS;
