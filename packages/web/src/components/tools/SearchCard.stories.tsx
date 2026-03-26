import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { SearchCard } from "./SearchCard.js";

const meta: Meta<typeof SearchCard> = {
  component: SearchCard,
  title: "Tools/SearchCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const GrepWithMatches: Story = {
  name: "Grep — multiple matches",
  args: {
    tool: "Grep",
    args: { pattern: "verifyToken", path: "src/" },
    result: "src/middleware/auth.ts:14:  export function verifyToken(req: Request) {\nsrc/routes/protected.ts:8:  const user = verifyToken(req);\nsrc/tests/auth.test.ts:22:  describe('verifyToken', () => {",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-search")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-pattern")).toHaveTextContent('"verifyToken"');
    await expect(canvas.getByTestId("tool-card-search-path")).toHaveTextContent("in src/");
    await expect(canvas.getByTestId("tool-card-match-count")).toHaveTextContent("3 matches");
  },
};

export const GlobFileList: Story = {
  name: "Glob — file list",
  args: {
    tool: "Glob",
    args: { pattern: "src/**/*.test.ts" },
    result: "src/auth.test.ts\nsrc/routes.test.ts\nsrc/middleware.test.ts\nsrc/utils.test.ts",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-match-count")).toHaveTextContent("4 matches");
  },
};

export const NoMatches: Story = {
  name: "No matches",
  args: {
    tool: "Grep",
    args: { pattern: "nonExistentSymbol", path: "src/" },
    result: "",
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId("tool-card-results")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-match-count")).not.toBeInTheDocument();
  },
};

export const InProgress: Story = {
  args: {
    tool: "Grep",
    args: { pattern: "TODO", path: "." },
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-search");
    await expect(card.className).toContain("inProgress");
  },
};

export const ErrorResult: Story = {
  args: {
    tool: "Grep",
    args: { pattern: "[invalid regex", path: "src/" },
    result: "Error: invalid regex pattern",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
