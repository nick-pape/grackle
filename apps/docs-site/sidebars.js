/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "getting-started/installation",
        "getting-started/root-chat",
        "getting-started/connect-environment",
        "getting-started/create-task",
        "getting-started/create-orchestration",
        "getting-started/claude-drives-grackle",
      ],
    },
    {
      type: "category",
      label: "Building Blocks",
      collapsed: false,
      items: [
        "building-blocks/environments-workspaces",
        "building-blocks/tasks-sessions",
        "building-blocks/personas-runtimes",
      ],
    },
    {
      type: "category",
      label: "Features",
      collapsed: false,
      items: [
        "features/web-ui",
        "features/chat",
        "features/cli",
        "features/mcp-server",
        "features/orchestration",
        "features/coordination",
        "features/credentials",
        "features/usage-budgets",
        "features/widgets",
        "features/knowledge-graph",
      ],
    },
    {
      type: "category",
      label: "Advanced Features",
      collapsed: false,
      items: ["advanced/scripting", "advanced/scheduled-tasks", "advanced/webhooks"],
    },
    {
      type: "category",
      label: "Extending",
      collapsed: false,
      items: ["extending/plugins"],
    },
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: [
        "architecture/kernel",
        "architecture/powerline-ahp",
        "architecture/mcp",
        "architecture/acp",
        "architecture/mcp-apps",
      ],
    },
    "roadmap",
  ],
};

module.exports = sidebars;
