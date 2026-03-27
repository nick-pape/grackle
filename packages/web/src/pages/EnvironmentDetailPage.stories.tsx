import type { JSX } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackle } from "@grackle-ai/web-components";
import { EnvironmentDetailPage } from "./EnvironmentDetailPage.js";

/** Wrapper that renders EnvironmentDetailPage at the given environment route. */
function DetailRouteWrapper({ envId }: { envId: string }): JSX.Element {
  return (
    <MemoryRouter initialEntries={[`/environments/${envId}`]}>
      <Routes>
        <Route path="/environments/:environmentId" element={<EnvironmentDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const meta: Meta = {
  component: EnvironmentDetailPage,
  decorators: [withMockGrackle],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** New Chat button is visible and enabled for a connected environment. */
export const NewChatButtonVisible: Story = {
  render: () => <DetailRouteWrapper envId="env-local-01" />,
  play: async ({ canvas }) => {
    const newChatButton = canvas.getByRole("button", { name: "New Chat" });
    await expect(newChatButton).toBeInTheDocument();
    await expect(newChatButton).toBeVisible();
    await expect(newChatButton).toBeEnabled();
  },
};
