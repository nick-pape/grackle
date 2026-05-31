import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, within } from "@storybook/test";
import { DocPane } from "./DocPane.js";
import type { DocumentTab, ResourceContentState } from "../../hooks/types.js";

const ENV: string = "env-1";

const MARKDOWN_TAB: DocumentTab = {
  id: `${ENV} file:///repo/plan.md`,
  environmentId: ENV,
  uri: "file:///repo/plan.md",
  title: "plan.md",
};
const CODE_TAB: DocumentTab = {
  id: `${ENV} file:///repo/server.ts`,
  environmentId: ENV,
  uri: "file:///repo/server.ts",
  title: "server.ts",
};
const BINARY_TAB: DocumentTab = {
  id: `${ENV} file:///repo/logo.png`,
  environmentId: ENV,
  uri: "file:///repo/logo.png",
  title: "logo.png",
};

const CONTENT: Record<string, ResourceContentState> = {
  "file:///repo/plan.md": {
    data: "# Project Plan\n\n- Step one\n- Step two *(live)*\n\nSome **bold** text and a `code` span.",
    encoding: "utf-8",
    contentType: "text/markdown",
  },
  "file:///repo/server.ts": {
    data: "export function serve(port: number): void {\n  console.log(`listening on ${port}`);\n}\n",
    encoding: "utf-8",
    contentType: "text/plain",
  },
  "file:///repo/logo.png": {
    data: "iVBORw0KGgoAAAANSUhEUgAA",
    encoding: "base64",
    contentType: "image/png",
  },
};

function getContent(_environmentId: string, uri: string): ResourceContentState | undefined {
  return CONTENT[uri];
}

const meta: Meta<typeof DocPane> = {
  title: "DocPane/DocPane",
  component: DocPane,
  args: {
    getContent,
    onSelectTab: fn(),
    onCloseTab: fn(),
    onOpenUri: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: 480, border: "1px solid #ccc" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof DocPane>;

/** A single markdown document rendered via react-markdown. */
export const MarkdownDocument: Story = {
  args: {
    tabs: [MARKDOWN_TAB],
    activeTabId: MARKDOWN_TAB.id,
    unseenTabIds: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("doc-pane")).toBeInTheDocument();
    await expect(canvas.getByTestId("doc-markdown")).toBeInTheDocument();
  },
};

/** Multiple tabs, with a non-active tab badged as having unseen changes. */
export const MultipleTabsWithBadge: Story = {
  args: {
    tabs: [MARKDOWN_TAB, CODE_TAB],
    activeTabId: MARKDOWN_TAB.id,
    unseenTabIds: [CODE_TAB.id],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tabs = canvas.getAllByTestId("doc-tab");
    await expect(tabs).toHaveLength(2);
    // The code tab carries the unseen badge.
    const badged = tabs.find((t) => t.getAttribute("data-unseen") === "true");
    await expect(badged).toBeDefined();
  },
};

/** A code/text file rendered read-only via the lazy-loaded CodeMirror preview. */
export const CodeDocument: Story = {
  args: {
    tabs: [CODE_TAB],
    activeTabId: CODE_TAB.id,
    unseenTabIds: [],
  },
};

/** A binary/unsupported file falls back to a friendly placeholder. */
export const BinaryFallback: Story = {
  args: {
    tabs: [BINARY_TAB],
    activeTabId: BINARY_TAB.id,
    unseenTabIds: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("doc-fallback")).toBeInTheDocument();
  },
};

/** A freshly-opened tab whose content has not yet arrived shows a loading state. */
export const Loading: Story = {
  args: {
    tabs: [{ ...MARKDOWN_TAB, uri: "file:///repo/unread.md", id: `${ENV} file:///repo/unread.md` }],
    activeTabId: `${ENV} file:///repo/unread.md`,
    unseenTabIds: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("doc-loading")).toBeInTheDocument();
  },
};
