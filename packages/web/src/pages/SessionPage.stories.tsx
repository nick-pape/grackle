import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackleRoute } from "../test-utils/storybook-helpers.js";
import { SessionPage } from "./SessionPage.js";

const meta: Meta<typeof SessionPage> = {
  component: SessionPage,
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Active running session renders the event stream. */
export const ActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Breadcrumbs should render for the session
    await expect(canvas.getByText("Home")).toBeInTheDocument();
    // Stop button visible for active session
    await expect(canvas.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  },
};

/** Stopped session shows ended state with New Chat button. */
export const StoppedSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-002"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Breadcrumbs should render
    await expect(canvas.getByText("Home")).toBeInTheDocument();
  },
};
