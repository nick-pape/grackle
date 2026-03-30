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
  const hasClaudeCode = ctx.personas.personas.some((p) => p.id === "claude-code");
  const hasSystem = ctx.personas.personas.some((p) => p.id === SYSTEM_PERSONA_ID);
  const personasList = [
    ...ctx.personas.personas,
    ...(!hasClaudeCode ? [SEED_PERSONA] : []),
    ...(!hasSystem ? [SYSTEM_PERSONA] : []),
  ];
  // Wrap updatePersona to handle injected seed personas that the mock
  // doesn't know about -- resolves immediately for seed/system personas.
  const seedIds: ReadonlySet<string> = new Set(["claude-code", SYSTEM_PERSONA_ID]);
  const wrappedUpdatePersona: typeof ctx.personas.updatePersona = async (personaId, ...args) => {
    if (seedIds.has(personaId)) {
      const match = personasList.find((p) => p.id === personaId);
      return match ?? SEED_PERSONA;
    }
    return ctx.personas.updatePersona(personaId, ...args);
  };
  const overridden = {
    ...ctx,
    onboardingCompleted: false,
    personas: { ...ctx.personas, personas: personasList, updatePersona: wrappedUpdatePersona },
  };
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

/** Subset of Storybook's canvas queries used by step-advance helpers. */
interface StepCanvas {
  getByTestId: (id: string) => HTMLElement;
  findByTestId: (id: string) => Promise<HTMLElement>;
}

/** Helper: advance the wizard from Welcome through About to the Runtime step. */
async function advanceToRuntime(canvas: StepCanvas): Promise<void> {
  await userEvent.click(canvas.getByTestId("setup-get-started"));
  const nextButton = await canvas.findByTestId("setup-about-next");
  await userEvent.click(nextButton);
  await canvas.findByTestId("setup-runtime");
}

/** Helper: advance from Welcome through Runtime to the Notification step. */
async function advanceToNotifications(canvas: StepCanvas): Promise<void> {
  await advanceToRuntime(canvas);
  const runtimeNext = await canvas.findByTestId("setup-runtime-next");
  await userEvent.click(runtimeNext);
  await canvas.findByTestId("setup-notifications");
}

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
    await advanceToRuntime(canvas);
    await expect(canvas.getByText("Choose Your Runtime")).toBeInTheDocument();
    await expect(canvas.getByTestId("runtime-card-claude-code")).toBeInTheDocument();
    await expect(canvas.getByTestId("runtime-card-copilot")).toBeInTheDocument();
    // Button now says "Next" (not "Finish") since notification step follows
    await expect(canvas.getByTestId("setup-runtime-next")).toBeInTheDocument();
  },
};

/** Notification step renders after runtime selection. */
export const NotificationStep: Story = {
  play: async ({ canvas }) => {
    await advanceToNotifications(canvas);
    await expect(canvas.getByText("Stay in the Loop")).toBeInTheDocument();
    // In Storybook (jsdom/iframe), Notification API may not exist, so the step
    // should show a Finish button (already-decided fallback) or Enable/Skip.
  },
};

/** Full onboarding flow: select Copilot and finish through notification step. */
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

    // Click Next to advance to notification step
    const runtimeNext = canvas.getByTestId("setup-runtime-next");
    await expect(runtimeNext).not.toBeDisabled();
    await userEvent.click(runtimeNext);

    // Notification step -- click whichever finish/skip button is available
    const notifStep = await canvas.findByTestId("setup-notifications");
    await expect(notifStep).toBeInTheDocument();

    // In Storybook, Notification API may not be available, so the component
    // renders "Finish" directly. Find whichever action button is present.
    const finishButton = notifStep.querySelector("[data-testid='setup-finish'], [data-testid='setup-notifications-skip']") as HTMLElement | null;
    if (finishButton) {
      await userEvent.click(finishButton);
    }

    // After finishing, the wizard navigates to "/" which renders the home-page
    await expect(await canvas.findByTestId("home-page")).toBeInTheDocument();
  },
};
