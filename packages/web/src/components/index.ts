/**
 * Component exports organized by category.
 * @module components
 */

// Layout components - application shell structure
export { StatusBar, Sidebar, ContextHintBar } from "./layout/index.js";

// Panel components - main content areas
export { FindingsPanel } from "./panels/index.js";

// List components - sidebar navigation
export { EnvironmentNav } from "./lists/index.js";

// Display components - content rendering
export { EventRenderer } from "./display/index.js";

// Notification components - toasts and callouts
export { Toast, ToastContainer, Callout } from "./notifications/index.js";
export type { CalloutVariant } from "./notifications/index.js";
