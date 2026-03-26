import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { MetadataCard } from "./MetadataCard.js";

const meta: Meta<typeof MetadataCard> = {
  component: MetadataCard,
  title: "Tools/MetadataCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ReportIntent: Story = {
  args: {
    tool: "report_intent",
    args: { intent: "Updating README getting started" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-metadata")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-metadata")).toHaveTextContent("Updating README getting started");
  },
};

export const UnknownMetadata: Story = {
  args: {
    tool: "report_intent",
    args: { description: "Planning implementation" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-metadata")).toHaveTextContent("Planning implementation");
  },
};
