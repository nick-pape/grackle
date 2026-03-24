import type { JSX } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { withMockGrackle } from "../test-utils/storybook-helpers.js";
import { SettingsPage } from "./SettingsPage.js";
import { SettingsCredentialsTab } from "./settings/SettingsCredentialsTab.js";
import { SettingsPersonasTab } from "./settings/SettingsPersonasTab.js";
import { SettingsAboutTab } from "./settings/SettingsAboutTab.js";
import { SettingsAppearanceTab } from "./settings/SettingsAppearanceTab.js";

/** Wrapper that sets up the nested settings routes with the given initial URL. */
function SettingsRouteWrapper({ initialEntry }: { initialEntry: string }): JSX.Element {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />}>
          <Route path="credentials" element={<SettingsCredentialsTab />} />
          <Route path="personas" element={<SettingsPersonasTab />} />
          <Route path="appearance" element={<SettingsAppearanceTab />} />
          <Route path="about" element={<SettingsAboutTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const meta: Meta = {
  component: SettingsPage,
  decorators: [withMockGrackle],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Credentials tab renders credential providers and tokens sections. */
export const CredentialsTab: Story = {
  render: () => <SettingsRouteWrapper initialEntry="/settings/credentials" />,
  play: async ({ canvas }) => {
    // Credential Providers section heading
    await expect(canvas.getByText("Credential Providers")).toBeInTheDocument();
    // Tokens section heading
    await expect(canvas.getByText("Tokens")).toBeInTheDocument();
  },
};

/** Personas tab renders the persona manager with persona cards. */
export const PersonasTab: Story = {
  render: () => <SettingsRouteWrapper initialEntry="/settings/personas" />,
  play: async ({ canvas }) => {
    // At least one persona card should be visible (mock data has multiple personas)
    await expect(canvas.getByTestId("persona-card-persona-arch")).toBeInTheDocument();
  },
};

/** About tab renders the about panel with connection info. */
export const AboutTab: Story = {
  render: () => <SettingsRouteWrapper initialEntry="/settings/about" />,
  play: async ({ canvas }) => {
    // About panel should be rendered
    await expect(canvas.getByTestId("about-panel")).toBeInTheDocument();
    // Connection status label should be visible
    await expect(canvas.getByText("Connection")).toBeInTheDocument();
  },
};

/** Appearance tab shows the theme picker. */
export const AppearanceTab: Story = {
  render: () => <SettingsRouteWrapper initialEntry="/settings/appearance" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    await expect(canvas.getByText("Choose how Grackle looks")).toBeInTheDocument();
    await expect(canvas.getByText("Match system light/dark preference")).toBeInTheDocument();
  },
};

/** Breadcrumbs show Home > Settings on the credentials tab. */
export const BreadcrumbsVisible: Story = {
  render: () => <SettingsRouteWrapper initialEntry="/settings/credentials" />,
  play: async ({ canvas }) => {
    const breadcrumbs = canvas.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeInTheDocument();
    await expect(breadcrumbs).toHaveTextContent(/Home/);
    await expect(breadcrumbs).toHaveTextContent(/Settings/);
  },
};
