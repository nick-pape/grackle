/**
 * Storybook interaction tests for AgentSettingsTab (#1447).
 *
 * Verifies editable environment picker and heartbeat fields without
 * a running server stack.
 *
 * testid suffix convention used by the Editable* components:
 *   - display mode (button): `${testId}-button`
 *   - edit mode (input/textarea): `${testId}-input`
 *   - edit mode (select): `${testId}-select`
 *   - EditableCheckbox: uses base `${testId}` directly on the label
 */
import type { JSX } from "react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { withMockGrackle } from "@grackle-ai/web-components";
import type { AgentData } from "@grackle-ai/web-components";
import { AgentSettingsTab } from "./AgentSettingsTab.js";
import type { AgentOutletContext } from "../AgentLayout.js";

// ---------------------------------------------------------------------------
// Local agent fixture — mirrors MOCK_AGENTS[0] but defined inline since
// MOCK_AGENTS is not yet a public storybook-helpers export.
// ---------------------------------------------------------------------------

const AGENT: AgentData = {
  id: "refactor-bot",
  name: "Refactor Bot",
  avatar: "🔧",
  primaryPersonaId: "persona-fe",
  environmentId: "env-local-01",
  heartbeat: {
    id: "hb-refactor-bot",
    title: "Refactor Bot Heartbeat",
    description: "Wake every 15 minutes and check the queue.",
    scheduleExpression: "*/15 * * * *",
    personaId: "persona-fe",
    workspaceId: "proj-alpha",
    parentTaskId: "rb-root",
    enabled: true,
    lastRunAt: "",
    nextRunAt: "",
    runCount: 42,
    createdAt: "2026-02-22T09:00:00Z",
    updatedAt: "2026-02-25T18:30:00Z",
  },
};

// ---------------------------------------------------------------------------
// Wrapper — provides the outlet context AgentSettingsTab reads via
// useAgentContext() → useOutletContext().
// ---------------------------------------------------------------------------

function SettingsTabRoute({ agent }: AgentOutletContext): JSX.Element {
  return (
    <MemoryRouter initialEntries={["/agents/refactor-bot/settings"]}>
      <Routes>
        <Route
          path="/agents/:agentId"
          element={<Outlet context={{ agent } satisfies AgentOutletContext} />}
        >
          <Route path="settings" element={<AgentSettingsTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const meta: Meta = {
  title: "pages/agent-tabs/AgentSettingsTab",
  component: AgentSettingsTab,
  decorators: [withMockGrackle],
  parameters: { skipRouter: true },
};
export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

/** Default rendering: shows the settings form with all sections. */
export const Default: Story = {
  render: () => <SettingsTabRoute agent={AGENT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Outer container — direct testid on the section div
    await expect(canvas.getByTestId("agent-settings-tab")).toBeInTheDocument();
    // Editable* display-mode elements render the base testid with `-button` suffix
    await expect(canvas.getByTestId("agent-settings-name-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("agent-settings-environment-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("agent-settings-persona-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("agent-settings-heartbeat-cadence-button")).toBeInTheDocument();
    // Delete button is a plain <Button> — uses the base testid directly
    await expect(canvas.getByTestId("agent-settings-delete")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Environment picker (#1447 Task 1)
// ---------------------------------------------------------------------------

/** Environment field is an editable select showing the display name, not the id. */
export const EnvironmentEditable: Story = {
  render: () => <SettingsTabRoute agent={AGENT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // EditableSelect in display mode renders a button with the `-button` suffix.
    const envButton = canvas.getByTestId("agent-settings-environment-button");
    await expect(envButton).toBeInTheDocument();

    // AGENT.environmentId = "env-local-01" → MockGrackleProvider maps it to "Local Dev".
    await expect(envButton).toHaveTextContent("Local Dev");
  },
};

/** Clicking the environment field switches it to edit mode (renders a <select>). */
export const EnvironmentSelectOpens: Story = {
  render: () => <SettingsTabRoute agent={AGENT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click the display-mode button to enter edit mode
    const envButton = canvas.getByTestId("agent-settings-environment-button");
    await userEvent.click(envButton);

    // EditableSelect in edit mode renders a <select> with the `-select` suffix
    await expect(canvas.getByTestId("agent-settings-environment-select")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Heartbeat section (#1447 Task 2 — routing through hook)
// ---------------------------------------------------------------------------

/** Heartbeat section is visible when the agent has a heartbeat. */
export const HeartbeatVisible: Story = {
  render: () => <SettingsTabRoute agent={AGENT} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // EditableTextField / EditableTextArea display-mode buttons use `-button` suffix
    await expect(canvas.getByTestId("agent-settings-heartbeat-cadence-button")).toBeInTheDocument();
    await expect(canvas.getByTestId("agent-settings-heartbeat-rules-button")).toBeInTheDocument();
    // EditableCheckbox uses the base testid directly on its <label>
    await expect(canvas.getByTestId("agent-settings-heartbeat-enabled")).toBeInTheDocument();
  },
};

/** No-heartbeat agent shows the "Set a cadence" prompt and a cadence field. */
export const HeartbeatAbsent: Story = {
  render: () => <SettingsTabRoute agent={{ ...AGENT, heartbeat: undefined }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No heartbeat configured/i)).toBeInTheDocument();
    // Cadence field still shown so the user can set one (display-mode button)
    await expect(canvas.getByTestId("agent-settings-heartbeat-cadence-button")).toBeInTheDocument();
    // No enabled checkbox when there is no schedule
    await expect(canvas.queryByTestId("agent-settings-heartbeat-enabled")).not.toBeInTheDocument();
  },
};
