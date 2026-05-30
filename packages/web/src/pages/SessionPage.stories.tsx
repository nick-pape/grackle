import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackleRoute } from "@grackle-ai/web-components";
import { SessionPage } from "./SessionPage.js";

const meta: Meta<typeof SessionPage> = {
  component: SessionPage,
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Active running session renders header with runtime and split stop button. */
export const ActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-001"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header shows truncated ID + runtime + status
    await expect(canvas.getByText(/Session:\s*sess-001/)).toBeInTheDocument();

    // Split stop button visible in header
    await expect(canvas.getByTestId("stop-split-button")).toBeInTheDocument();
  },
};

/** A subagent child session shows a back-link to its parent (#1075). */
export const SubagentChildWithParentLink: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sub_sess-002_toolu_1"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Header shows the truncated child id + subagent runtime
    await expect(canvas.getByText(/Session:\s*sub_sess/)).toBeInTheDocument();
    // Parent back-link points at the parent session, URL-encoded via sessionUrl()
    const parentLink: HTMLAnchorElement = canvas.getByTestId("session-parent-link");
    await expect(parentLink).toBeInTheDocument();
    await expect(parentLink).toHaveAttribute("href", "/sessions/sess-002");
  },
};

/** Stopped session shows end reason and no stop button. */
export const StoppedSession: Story = {
  decorators: [withMockGrackleRoute(["/sessions/sess-002"], "/sessions/:sessionId")],
  play: async ({ canvas }) => {
    // Session header shows truncated ID
    await expect(canvas.getByText(/Session:\s*sess-002/)).toBeInTheDocument();

    // End reason appears (in header and/or empty state — at least one match)
    const completedElements: HTMLElement[] = canvas.getAllByText(/completed/);
    await expect(completedElements.length).toBeGreaterThan(0);

    // No split stop button for stopped session
    await expect(canvas.queryByTestId("stop-split-button")).not.toBeInTheDocument();
  },
};
