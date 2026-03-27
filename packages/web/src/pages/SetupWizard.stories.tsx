import type { ReactNode, JSX } from "react";
import { useContext } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import type { Decorator } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { GrackleContext } from "../context/GrackleContext.js";
import { MockGrackleProvider, SidebarProvider } from "@grackle-ai/web-components";
import { SetupWizard } from "./SetupWizard.js";

/**
 * Wrapper that reads the MockGrackleProvider context and re-provides it
 * with onboardingCompleted forced to false, so the SetupWizard renders
 * instead of redirecting to "/".
 */
function OnboardingOverride({ children }: { children: ReactNode }): JSX.Element {
  const ctx = useContext(GrackleContext);
  if (!ctx) {
    throw new Error("OnboardingOverride must be used within MockGrackleProvider");
  }
  const overridden = { ...ctx, onboardingCompleted: false };
  return (
    <GrackleContext.Provider value={overridden}>
      {children}
    </GrackleContext.Provider>
  );
}

/** Decorator that provides mock data with onboarding incomplete + MemoryRouter at /setup. */
const withSetupContext: Decorator = (Story) => (
  <MockGrackleProvider>
    <OnboardingOverride>
      <MemoryRouter initialEntries={["/setup"]}>
        <SidebarProvider>
          <Routes>
            <Route path="/setup" element={<Story />} />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>
    </OnboardingOverride>
  </MockGrackleProvider>
);

const meta: Meta<typeof SetupWizard> = {
  component: SetupWizard,
  decorators: [withSetupContext],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Welcome step renders heading and Get Started button. */
export const WelcomeStep: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("setup-welcome")).toBeInTheDocument();
    await expect(canvas.getByText("Welcome to Grackle")).toBeInTheDocument();
    await expect(canvas.getByTestId("setup-get-started")).toBeInTheDocument();
  },
};

/** Runtime step renders runtime selection cards after advancing through the wizard. */
export const RuntimeStep: Story = {
  play: async ({ canvas }) => {
    // Start on Welcome step, click Get Started
    const getStartedButton = canvas.getByTestId("setup-get-started");
    await userEvent.click(getStartedButton);

    // Now on About step — click Next to advance to Runtime step
    const nextButton = await canvas.findByTestId("setup-about-next");
    await userEvent.click(nextButton);

    // Runtime step should now be visible
    await expect(await canvas.findByTestId("setup-runtime")).toBeInTheDocument();
    await expect(canvas.getByText("Choose Your Runtime")).toBeInTheDocument();
    // Runtime cards should be visible
    await expect(canvas.getByTestId("runtime-card-claude-code")).toBeInTheDocument();
    await expect(canvas.getByTestId("runtime-card-copilot")).toBeInTheDocument();
  },
};
