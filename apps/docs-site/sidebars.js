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
        'guides/auth',
        'guides/mcp',
        'guides/orchestration',
        'guides/web-ui',
        'guides/cli-reference',
      ],
    },
  ],
};

module.exports = sidebars;
