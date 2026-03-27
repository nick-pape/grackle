import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackleRoute } from "@grackle-ai/web-components/src/test-utils/storybook-helpers.js";
import { ChatPage } from "./ChatPage.js";

const meta: Meta<typeof ChatPage> = {
  component: ChatPage,
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Chat page renders with the chat container present. */
export const WithActiveSession: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
  play: async ({ canvas }) => {
    // The chat page container should be in the document
    await expect(canvas.getByTestId("chat-page")).toBeInTheDocument();
  },
};

/**
 * Empty state renders when no root-task session exists.
 * The default mock data has no ROOT_TASK_ID ("system") task,
 * so the chat page shows the welcome empty state.
 */
export const EmptyState: Story = {
  decorators: [withMockGrackleRoute(["/chat"], "/chat")],
  play: async ({ canvas }) => {
    // The chat page container should render
    await expect(canvas.getByTestId("chat-page")).toBeInTheDocument();
    // Empty state should show the welcome message (local env exists in mock data)
    await expect(canvas.getByTestId("chat-empty-state")).toBeInTheDocument();
    await expect(canvas.getByText("Welcome to Grackle")).toBeInTheDocument();
  },
};
