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

/** Active running session renders the event stream and session header. */
export const ActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session ID prefix should appear in the header
    await expect(canvas.getByText(/sess-001/)).toBeInTheDocument();
    // The session shows runtime info
    await expect(canvas.getByText(/claude-code/)).toBeInTheDocument();
  },
};

/** Stopped session renders without a kill button and shows ended state. */
export const StoppedSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001-prev"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session ID prefix should appear in the header
    await expect(canvas.getByText(/sess-001-/)).toBeInTheDocument();
    // Stopped sessions show the end reason
    await expect(canvas.getByText(/interrupted/)).toBeInTheDocument();
  },
};
