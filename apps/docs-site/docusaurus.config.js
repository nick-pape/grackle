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
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/nick-pape/grackle/edit/main/apps/docs-site/',
        },
        blog: false,
        theme: { customCss: require.resolve('./src/css/custom.css') },
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
