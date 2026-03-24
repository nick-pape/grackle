/**
 * Storybook decorators for page-level components that call useGrackle().
 */

import type { Decorator } from "@storybook/react";
import { MemoryRouter, Routes, Route } from "react-router";
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

/**
 * Creates a decorator that wraps the story in MockGrackleProvider + MemoryRouter
 * with the given initial route entries and a catch-all Route for useParams().
 *
 * Use with `parameters: { skipRouter: true }` in the story meta to prevent
 * the global preview.tsx from adding a second MemoryRouter.
 *
 * @example
 * ```tsx
 * const meta = {
 *   component: TaskPage,
 *   decorators: [withMockGrackleRoute(["/tasks/task-001"], "/tasks/:taskId")],
 *   parameters: { skipRouter: true },
 * };
 * ```
 */
export function withMockGrackleRoute(initialEntries: string[], routePath: string = "*"): Decorator {
  return (Story) => (
    <MockGrackleProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <SidebarProvider>
          <Routes>
            <Route path={routePath} element={<Story />} />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </MockGrackleProvider>
  );
}
