/**
 * Content rendering and display components.
 * @module display
 */
export { Breadcrumbs } from "./Breadcrumbs.js";
export { Button } from "./Button.js";
export { CopyButton } from "./CopyButton.js";
export { DemoBanner } from "./DemoBanner.js";
export { SplitButton } from "./SplitButton.js";
export { EventRenderer } from "./EventRenderer.js";
export { ConfirmDialog } from "./ConfirmDialog.js";
export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton.js";
export { Spinner } from "./Spinner.js";
export { SplashScreen } from "./SplashScreen.js";
export { Tooltip } from "./Tooltip.js";
export { SessionAttemptSelector } from "./SessionAttemptSelector.js";
// NOTE: McpAppWidget is intentionally NOT re-exported as a value — EventRenderer
// lazy-imports it directly so the heavy ext-apps AppBridge stays code-split out of
// the main chat bundle. Its prop types remain exported below for consumers.

export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button.js";
export type { TooltipProps, TooltipPlacement } from "./Tooltip.js";
export type { SessionAttemptSelectorProps } from "./SessionAttemptSelector.js";
export type { McpAppWidgetProps, McpAppWidgetCallToolParams } from "./McpAppWidget.js";
