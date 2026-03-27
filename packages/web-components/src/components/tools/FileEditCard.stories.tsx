import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { FileEditCard } from "./FileEditCard.js";

const meta: Meta<typeof FileEditCard> = {
  component: FileEditCard,
  title: "Tools/FileEditCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const FromOldNewStrings: Story = {
  name: "Claude Code - old/new strings",
  args: {
    tool: "Edit",
    args: {
      file_path: "/src/middleware/auth.ts",
      old_string: 'const secret = "hardcoded";\nconst expiry = 3600;',
      new_string: 'const secret = process.env.JWT_SECRET;\nif (!secret) {\n  throw new Error("JWT_SECRET is required");\n}\nconst expiry = 86400;',
    },
    result: "File updated successfully",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-edit")).toBeInTheDocument();
    await expect(canvas.getByText("auth.ts")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-diff-stats")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-diff")).toBeInTheDocument();
  },
};

export const FromUnifiedDiff: Story = {
  name: "Copilot - unified diff in detailedResult",
  args: {
    tool: "edit",
    args: {
      path: "C:\\Users\\nickp\\src\\grackle4\\README.md",
      old_str: "## Requirements",
      new_str: "## Getting Started\n\n```bash\nnpm install\nrush build\nrush serve\n```\n\n## Requirements",
    },
    result: "File updated with changes.",
    detailedResult: `diff --git a/README.md b/README.md
index 0000000..0000001 100644
--- a/README.md
+++ b/README.md
@@ -280,6 +280,15 @@
 \`\`\`
 </details>

+## Getting Started
+
+\`\`\`bash
+npm install
+rush build
+rush serve
+\`\`\`
+
 ## Requirements

 - Docker (recommended)`,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-diff")).toBeInTheDocument();
    // Should show the parsed unified diff, not the old/new fallback
    const diff = canvas.getByTestId("tool-card-diff");
    await expect(diff.textContent).toContain("Getting Started");
  },
};

export const SmallEdit: Story = {
  name: "Single-line change",
  args: {
    tool: "Edit",
    args: {
      file_path: "/src/config.ts",
      old_string: "const PORT = 3000;",
      new_string: "const PORT = 8080;",
    },
    result: "File updated",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("config.ts")).toBeInTheDocument();
    // No toggle for <=5 diff lines
    await expect(canvas.queryByTestId("tool-card-toggle")).not.toBeInTheDocument();
  },
};

export const LargeDiffExpandCollapse: Story = {
  name: "Large diff - expand/collapse",
  args: {
    tool: "Edit",
    args: {
      file_path: "/src/routes/api.ts",
      old_string: "line 1\nline 2\nline 3\nline 4\nline 5",
      new_string: "new line 1\nnew line 2\nnew line 3\nnew line 4\nnew line 5\nnew line 6\nnew line 7\nnew line 8",
    },
    result: "File updated",
  },
  play: async ({ canvas }) => {
    // Should have toggle (5 removes + 8 adds = 13 lines > 5)
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();

    // Expand
    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("collapse");

    // Collapse
    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("more lines");
  },
};

export const InProgress: Story = {
  args: {
    tool: "Edit",
    args: { file_path: "/src/index.ts", old_string: "foo", new_string: "bar" },
    // No result yet
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-file-edit");
    await expect(card.className).toContain("inProgress");
  },
};

export const ErrorResult: Story = {
  args: {
    tool: "edit",
    args: { path: "/src/missing.ts", old_str: "x", new_str: "y" },
    result: "Error: old_str not found in file",
    isError: true,
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-file-edit");
    await expect(card.className).toContain("cardRed");
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
