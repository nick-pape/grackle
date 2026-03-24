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

/** Active running session renders header and kill button. */
export const ActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header renders with session info
    await expect(canvas.getByText(/Session:\s*sess-001/)).toBeInTheDocument();

    // Kill button (×) visible for active session via title attribute
    await expect(canvas.getByTitle("Stop session")).toBeInTheDocument();
  },
};

/** Stopped session shows end reason and no kill button. */
export const StoppedSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-002"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header renders with session info including end reason
    await expect(canvas.getByText(/Session:\s*sess-002/)).toBeInTheDocument();
    await expect(canvas.getByText(/completed/)).toBeInTheDocument();

    // No kill button for stopped session
    const killButton: HTMLElement | null = canvas.queryByTitle("Stop session");
    await expect(killButton).not.toBeInTheDocument();
  },
};
