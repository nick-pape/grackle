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

/** Active running session renders header with runtime, status, and kill button. */
export const ActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header shows truncated ID + runtime + status
    await expect(canvas.getByText(/sess-001/)).toBeInTheDocument();
    await expect(canvas.getByText(/claude-code/)).toBeInTheDocument();
    await expect(canvas.getByText(/running/)).toBeInTheDocument();

    // Prompt snippet visible in header
    await expect(canvas.getByText(/Implement auth middleware/)).toBeInTheDocument();

    // Kill button (×) visible for active session
    await expect(canvas.getByTitle("Stop session")).toBeInTheDocument();
  },
};

/** Stopped session shows end reason and no kill button. */
export const StoppedSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-002"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header shows truncated ID + runtime + end reason
    await expect(canvas.getByText(/sess-002/)).toBeInTheDocument();
    await expect(canvas.getByText(/claude-code/)).toBeInTheDocument();
    await expect(canvas.getByText(/completed/)).toBeInTheDocument();

    // No kill button for stopped session
    const killButton: HTMLElement | null = canvas.queryByTitle("Stop session");
    await expect(killButton).not.toBeInTheDocument();

    // Empty state message for stopped session with no events
    await expect(canvas.getByText(/Session completed with no events recorded/)).toBeInTheDocument();
  },
};
