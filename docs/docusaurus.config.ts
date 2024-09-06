import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Cuple RPC",
  tagline:
    "Typesharing between frontend and backends made easy. The missing type-safety for full-stack.",
  favicon: "img/favicon.ico",

  // Set the production url of your site here
  url: "https://fxdave.github.io",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/cuple",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "fxdave", // Usually your GitHub org/user name.
  projectName: "cuple", // Usually your repo name.

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/fxdave/cuple/tree/main/docs",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    // ... Your other themes.
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      {
        // ... Your options.
        // `hashed` is recommended as long-term-cache of index file is possible.
        hashed: true,
        // For Docs using Chinese, The `language` is recommended to set to:
        // ```
        // language: ["en", "zh"],
        // ```
      },
    ],
  ],
  themeConfig: {
    colorMode: {
      defaultMode: "dark",
    },
    // Replace with your project's social card
    image: "img/cuple_compact_light_export.svg",
    navbar: {
      logo: {
        alt: "Cuple",
        src: "img/cuple_light_export.svg",
        srcDark: "img/cuple_dark_export.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "clientSidebar",
          position: "left",
          label: "Client Docs",
        },
        {
          type: "docSidebar",
          sidebarId: "serverSidebar",
          position: "left",
          label: "Server Docs",
        },
        {
          href: "https://github.com/fxdave/react-express-cuple-boilerplate",
          label: "Try the Boilerplate",
          position: "right",
        },
        {
          href: "https://stackblitz.com/~/github.com/fxdave/react-express-cuple-boilerplate/tree/stackblitz?file=backend/src/index.ts",
          label: "Try in StackBlitz",
          position: "right",
        },
        {
          href: "https://github.com/fxdave/cuple",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "light",
      logo: {
        srcDark: "/img/cuple_dark_export.svg",
        src: "/img/cuple_light_export.svg",
        height: "100px",
      },
      copyright: `This page is licensed under a Creative Commons Attribution-NoDerivatives 4.0 International License. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.vsDark,
      darkTheme: prismThemes.vsDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
