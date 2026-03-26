const { themes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Grackle',
  tagline: 'Run any AI coding agent on any remote environment',
  url: 'https://nick-pape.github.io',
  baseUrl: '/grackle/',
  organizationName: 'nick-pape',
  projectName: 'grackle',
  onBrokenLinks: 'throw',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  favicon: 'img/favicon.ico',

  plugins: [
    function suppressMermaidWarning() {
      return {
        name: 'suppress-mermaid-warning',
        configureWebpack() {
          return {
            ignoreWarnings: [
              {
                module: /vscode-languageserver-types/,
                message: /Critical dependency/,
              },
            ],
          };
        },
      };
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/nick-pape/grackle/edit/main/apps/docs-site/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Grackle',
      logo: {
        alt: 'Grackle',
        src: 'img/grackle-logo.png',
      },
      items: [
        { to: '/', label: 'Docs', position: 'left' },
        { href: '/grackle/demo/', label: 'Try Demo', position: 'left' },
        { href: 'https://github.com/nick-pape/grackle', label: 'GitHub', position: 'right' },
      ],
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  },
};

module.exports = config;
