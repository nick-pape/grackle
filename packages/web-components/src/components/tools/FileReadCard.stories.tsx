import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { FileReadCard } from "./FileReadCard.js";

const meta: Meta<typeof FileReadCard> = {
  component: FileReadCard,
  title: "Grackle/Tools/FileReadCard",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_FILE: string = `import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token" });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
}`;

export const WithContent: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/middleware/auth.ts" },
    result: SAMPLE_FILE,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-read")).toBeInTheDocument();
    await expect(canvas.getByText("auth.ts")).toBeInTheDocument();
    await expect(canvas.getByText("19 lines")).toBeInTheDocument();
    // Should show toggle for >5 lines
    await expect(canvas.getByTestId("tool-card-toggle")).toBeInTheDocument();
  },
};

export const ExpandCollapse: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/middleware/auth.ts" },
    result: SAMPLE_FILE,
  },
  play: async ({ canvas }) => {
    // Initially collapsed - line 10 content should not be visible
    const content = canvas.getByTestId("tool-card-content");
    await expect(content.textContent).not.toContain("const decoded");

    // Click toggle to expand
    const toggle = canvas.getByTestId("tool-card-toggle");
    await userEvent.click(toggle);

    // Now line 13 content should be visible
    await expect(content.textContent).toContain("const decoded");

    // Click again to collapse
    await userEvent.click(toggle);
    await expect(content.textContent).not.toContain("const decoded");
  },
};

export const ShortFile: Story = {
  args: {
    tool: "view",
    args: { path: "C:\\Users\\nickp\\src\\config.json" },
    result: '{\n  "port": 3000\n}',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("config.json")).toBeInTheDocument();
    await expect(canvas.getByText("3 lines")).toBeInTheDocument();
    // No toggle for <=5 lines
    await expect(canvas.queryByTestId("tool-card-toggle")).not.toBeInTheDocument();
  },
};

export const InProgress: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/index.ts" },
    // No result - still loading
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-file-read");
    await expect(card.className).toContain("inProgress");
    await expect(canvas.getByText("index.ts")).toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-content")).not.toBeInTheDocument();
  },
};

export const ErrorResult: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/nonexistent/file.ts" },
    result: "Error: ENOENT: no such file or directory",
    isError: true,
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-file-read");
    await expect(card.className).toContain("cardRed");
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};

export const EmptyFile: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/empty.ts" },
    result: "",
  },
};
