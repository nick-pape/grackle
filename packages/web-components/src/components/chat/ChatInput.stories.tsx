import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { ChatInput } from "./ChatInput.js";
import type { Environment } from "../../hooks/types.js";
import { makeEnvironment, makePersona } from "../../test-utils/storybook-helpers.js";

const connectedEnv: Environment = makeEnvironment({ id: "local", displayName: "Local", status: "connected" });

const meta: Meta<typeof ChatInput> = {
  component: ChatInput,
  title: "Grackle/Chat/ChatInput",
  tags: ["autodocs"],
  args: {
    personas: [makePersona({ id: "p1", name: "Software Engineer" })],
    environments: [connectedEnv],
    onSendInput: fn(),
    onSpawn: fn(),
    onStartTask: fn(),
    onProvisionEnvironment: fn(),
    onShowToast: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Send mode shows text input and Send button. */
export const SendMode: Story = {
  args: {
    mode: "send",
    sessionId: "sess-1",
    environmentId: "local",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
  },
};

/** Spawn mode shows persona selector when showPersonaSelect is true. */
export const SpawnModeWithPersonaSelect: Story = {
  args: {
    mode: "spawn",
    environmentId: "local",
    showPersonaSelect: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Enter prompt...")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Go" })).toBeDisabled();
    // Persona selector should be present
    const select = canvas.getByDisplayValue("(Default)");
    await expect(select).toBeInTheDocument();
  },
};

/** Go button is disabled when no environmentId is provided. */
export const SpawnModeNoEnv: Story = {
  args: {
    mode: "spawn",
    environmentId: "",
    showPersonaSelect: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Go" })).toBeDisabled();
  },
};

/** Start mode shows text input and Send button. */
export const StartMode: Story = {
  args: {
    mode: "start",
    taskId: "task-1",
    environmentId: "local",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
  },
};

/**
 * Regression guard: typed text must survive a mode flip.
 * ChatPage now renders a single ChatInput instance and changes the mode prop
 * instead of unmounting/remounting. This story verifies the local text state
 * is preserved when mode transitions from "start" to "send".
 */
function ModeFlipWrapper(): JSX.Element {
  const [mode, setMode] = useState<"start" | "send">("start");
  return (
    <div>
      <ChatInput
        mode={mode}
        taskId="task-1"
        sessionId="sess-1"
        environmentId="local"
        personas={[]}
        environments={[connectedEnv]}
        onSendInput={fn()}
        onSpawn={fn()}
        onStartTask={fn()}
        onProvisionEnvironment={fn()}
        onShowToast={fn()}
      />
      <button type="button" onClick={() => setMode("send")} data-testid="flip-mode-btn">
        Flip to send
      </button>
    </div>
  );
}

export const ModeFlipPreservesText: Story = {
  render: () => <ModeFlipWrapper />,
  play: async ({ canvas }) => {
    const input = canvas.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "draft message");
    await expect(input).toHaveValue("draft message");

    await userEvent.click(canvas.getByTestId("flip-mode-btn"));

    // Text must survive the mode flip (component stays mounted, state is preserved)
    await expect(input).toHaveValue("draft message");
  },
};

/** Send mode renders input and Send button (Stop is in page header, not ChatInput). */
export const SendModeActive: Story = {
  args: {
    mode: "send",
    sessionId: "sess-1",
    environmentId: "local",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
  },
};
