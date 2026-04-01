/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Concepts',
      collapsed: false,
      items: [
        'concepts/environments',
        'concepts/sessions',
        'concepts/runtimes',
        'concepts/projects-tasks',
        'concepts/findings',
        'concepts/personas',
        'concepts/powerline',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/web-ui',
        'guides/chat',
        'guides/orchestration',
        'guides/credentials',
        'guides/auth',
        'guides/cli-reference',
      ],
    },
    {
      type: 'category',
      label: 'Extending Grackle',
      collapsed: false,
      items: [
        'guides/mcp',
        'guides/plugins',
        'guides/knowledge-graph',
        'guides/scheduled-triggers',
      ],
    },
  ],
};

module.exports = sidebars;
