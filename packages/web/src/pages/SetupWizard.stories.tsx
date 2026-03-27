import type { ReactNode, JSX } from "react";
import { useContext } from "react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import type { Decorator } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { SYSTEM_PERSONA_ID } from "@grackle-ai/common";
import { GrackleContext } from "../context/GrackleContext.js";
import { MockGrackleProvider, SidebarProvider, makePersona } from "@grackle-ai/web-components";
import type { PersonaData } from "@grackle-ai/web-components";
import { SetupWizard } from "./SetupWizard.js";

/** Seed persona required by SetupWizard (looks up id "claude-code"). */
const SEED_PERSONA: PersonaData = makePersona({ id: "claude-code", name: "Software Engineer", runtime: "claude-code", model: "sonnet" });
/** System persona synced during onboarding. */
const SYSTEM_PERSONA: PersonaData = makePersona({ id: SYSTEM_PERSONA_ID, name: "System", runtime: "claude-code", model: "sonnet" });

/**
 * Wrapper that reads the MockGrackleProvider context and re-provides it
 * with onboardingCompleted forced to false and the seed personas injected,
 * so the SetupWizard renders instead of redirecting to "/".
 *
 * Also wraps updatePersona so it handles the injected seed personas
 * (the mock's internal state doesn't include them).
 */
function OnboardingOverride({ children }: { children: ReactNode }): JSX.Element {
  const ctx = useContext(GrackleContext);
  if (!ctx) {
    throw new Error("OnboardingOverride must be used within MockGrackleProvider");
  }
  // Inject seed personas if not already present
  const hasClaudeCode = ctx.personas.some((p) => p.id === "claude-code");
  const hasSystem = ctx.personas.some((p) => p.id === SYSTEM_PERSONA_ID);
  const personas = [
    ...ctx.personas,
    ...(!hasClaudeCode ? [SEED_PERSONA] : []),
    ...(!hasSystem ? [SYSTEM_PERSONA] : []),
  ];
  // Wrap updatePersona to handle injected seed personas that the mock
  // doesn't know about — resolves immediately for seed/system personas.
  const seedIds: ReadonlySet<string> = new Set(["claude-code", SYSTEM_PERSONA_ID]);
  const wrappedUpdatePersona: typeof ctx.updatePersona = async (personaId, ...args) => {
    if (seedIds.has(personaId)) {
      const match = personas.find((p) => p.id === personaId);
      return match ?? SEED_PERSONA;
    }
    return ctx.updatePersona(personaId, ...args);
  };
  const overridden = { ...ctx, onboardingCompleted: false, personas, updatePersona: wrappedUpdatePersona };
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
            <Route path="/" element={<div data-testid="home-page">Home</div>} />
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

/** Full onboarding flow: select Copilot and finish without errors. */
export const FinishWithCopilot: Story = {
  play: async ({ canvas }) => {
    // Welcome step
    await userEvent.click(canvas.getByTestId("setup-get-started"));

    // About step
    const nextButton = await canvas.findByTestId("setup-about-next");
    await userEvent.click(nextButton);

    // Runtime step -- select Copilot
    const copilotCard = await canvas.findByTestId("runtime-card-copilot");
    await userEvent.click(copilotCard);
    await expect(copilotCard).toHaveAttribute("data-selected", "true");

    // Click Finish
    const finishButton = canvas.getByTestId("setup-finish");
    await expect(finishButton).not.toBeDisabled();
    await userEvent.click(finishButton);

    // After finishing, the wizard navigates to "/" which renders the home-page
    // element. Wait for it to appear rather than using a fixed sleep.
    await expect(await canvas.findByTestId("home-page")).toBeInTheDocument();
  },
};
