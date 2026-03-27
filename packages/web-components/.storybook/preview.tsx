import type { Preview } from "@storybook/react";
import type { JSX } from "react";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "../src/context/ToastContext.js";
import { ThemeProvider } from "../src/context/ThemeContext.js";
import "../src/styles/global.scss";

/**
 * Wraps every story in the providers components need (theme, toast, router).
 * Stories that set `parameters.skipRouter: true` get no MemoryRouter —
 * they provide their own (e.g., page stories with initialEntries).
 */
const preview: Preview = {
  decorators: [
    (Story, context) => {
      const skipRouter: boolean = context.parameters?.skipRouter === true;
      const inner: JSX.Element = (
        <ThemeProvider>
          <ToastProvider>
            <Story />
          </ToastProvider>
        </ThemeProvider>
      );
      return skipRouter ? inner : <MemoryRouter>{inner}</MemoryRouter>;
    },
  ],
};

export default preview;

