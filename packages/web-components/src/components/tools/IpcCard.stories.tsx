import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { IpcCard } from "./IpcCard.js";

const meta: Meta<typeof IpcCard> = {
  component: IpcCard,
  title: "Tools/IpcCard",
};
export default meta;
type Story = StoryObj<typeof IpcCard>;

export const SpawnInProgress: Story = {
  name: "ipc_spawn - in progress",
  args: {
    tool: "mcp__grackle__ipc_spawn",
    args: {
      prompt: "Investigate the authentication module and report findings",
      pipe: "async",
      environmentId: "local",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-info")).toHaveTextContent("[async]");
    await expect(canvas.getByTestId("tool-card-ipc-prompt")).toBeInTheDocument();
  },
};

export const SpawnCompleted: Story = {
  name: "ipc_spawn - async result",
  args: {
    tool: "mcp__grackle__ipc_spawn",
    args: { prompt: "Run tests", pipe: "async", environmentId: "local" },
    result: JSON.stringify({
      sessionId: "abc123-def456",
      fd: 3,
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-session")).toHaveTextContent("abc123-def456");
  },
};

export const WriteToFd: Story = {
  name: "ipc_write - success",
  args: {
    tool: "mcp__grackle__ipc_write",
    args: { fd: 3, message: "Please also check the error handling paths" },
    result: JSON.stringify({ success: true }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-info")).toHaveTextContent("fd:3");
    await expect(canvas.getByTestId("tool-card-ipc-success")).toHaveTextContent("ok");
  },
};

export const CloseFd: Story = {
  name: "ipc_close - success",
  args: {
    tool: "mcp__grackle__ipc_close",
    args: { fd: 3 },
    result: JSON.stringify({ success: true, stopped: true }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-info")).toHaveTextContent("fd:3");
  },
};

export const ListFds: Story = {
  name: "ipc_list_fds - with descriptors",
  args: {
    tool: "mcp__grackle__ipc_list_fds",
    args: {},
    result: JSON.stringify({
      fds: [
        { fd: 3, streamName: "child-1", permission: "rw", deliveryMode: "async", owned: true, targetSessionId: "sess-1" },
        { fd: 4, streamName: "child-2", permission: "r", deliveryMode: "detach", owned: false, targetSessionId: "sess-2" },
      ],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-fd-count")).toHaveTextContent("2 fds");
    await expect(canvas.getByTestId("tool-card-ipc-fds")).toBeInTheDocument();
  },
};

export const Terminate: Story = {
  name: "ipc_terminate - success",
  args: {
    tool: "mcp__grackle__ipc_terminate",
    args: { fd: 3 },
    result: JSON.stringify({ success: true, targetSessionId: "sess-1" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-success")).toHaveTextContent("ok");
  },
};

export const CreateStream: Story = {
  name: "ipc_create_stream - result",
  args: {
    tool: "mcp__grackle__ipc_create_stream",
    args: { name: "broadcast-channel" },
    result: JSON.stringify({ streamId: "stream-abc", fd: 5 }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-ipc-info")).toHaveTextContent("broadcast-channel");
  },
};

export const ErrorState: Story = {
  name: "ipc_write - error",
  args: {
    tool: "mcp__grackle__ipc_write",
    args: { fd: 99, message: "hello" },
    result: "gRPC error [NotFound]: fd 99 not found",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
