/**
 * Storybook decorators for page-level components that call useGrackle().
 */

import type { Decorator } from "@storybook/react";
import { MockGrackleProvider } from "../mocks/MockGrackleProvider.js";
import { SidebarProvider } from "../context/SidebarContext.js";

/**
 * Decorator for stories that test page-level components which call useGrackle().
 * Apply via `decorators: [withMockGrackle]` in the story meta.
 */
export const withMockGrackle: Decorator = (Story) => (
  <MockGrackleProvider>
    <SidebarProvider>
      <Story />
    </SidebarProvider>
  </MockGrackleProvider>
);
