import type { JSX } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackle } from "@grackle-ai/web-components";
import { PersonaLibraryPage } from "./PersonaLibraryPage.js";

/** Wrapper that mounts PersonaLibraryPage at the top-level `/personas` route. */
function PersonaLibraryRouteWrapper(): JSX.Element {
  return (
    <MemoryRouter initialEntries={["/personas"]}>
      <Routes>
        <Route path="/personas" element={<PersonaLibraryPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const meta: Meta = {
  component: PersonaLibraryPage,
  decorators: [withMockGrackle],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** List view renders mock persona cards and the new top-level breadcrumb trail. */
export const ListPersonas: Story = {
  render: () => <PersonaLibraryRouteWrapper />,
  play: async ({ canvas }) => {
    // At least one persona card should render (mock data has several).
    await expect(canvas.getByTestId("persona-card-persona-arch")).toBeInTheDocument();
    // Breadcrumbs now read Home > Personas (no "Settings" anywhere).
    const breadcrumbs = canvas.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeInTheDocument();
    await expect(breadcrumbs).toHaveTextContent(/Home/);
    await expect(breadcrumbs).toHaveTextContent(/Personas/);
    await expect(breadcrumbs).not.toHaveTextContent(/Settings/);
  },
};
