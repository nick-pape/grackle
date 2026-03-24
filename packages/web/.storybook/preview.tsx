import type { Preview, Decorator } from "@storybook/react";
import type { JSX } from "react";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "../src/context/ToastContext.js";
import { ThemeProvider } from "../src/context/ThemeContext.js";
import { MockGrackleProvider } from "../src/mocks/MockGrackleProvider.js";
import { SidebarProvider } from "../src/context/SidebarContext.js";
import "../src/styles/global.scss";

/** Wraps every story in the providers components need (theme, toast, router). */
function StoryProviders({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>
          {children}
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

const preview: Preview = {
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
};

export default preview;

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

