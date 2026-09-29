import path from "node:path";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

const excluded = [...configDefaults.exclude, "**/dist/**"];

export default defineConfig({
  plugins: [viteTsConfigPaths()],
  esbuild: { jsx: "automatic" },
  resolve: {
    // Packages import each other by name too, which would otherwise load a
    // second copy from `dist` and break `instanceof` across them.
    alias: [
      {
        find: /^@cuple\/react\/testing$/,
        replacement: path.resolve(__dirname, "packages/react/src/testing.tsx"),
      },
      {
        find: /^@cuple\/(client|server|inspect|openapi|react|mcp)$/,
        replacement: path.resolve(__dirname, "packages/$1/src/index.ts"),
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          exclude: [...excluded, "**/src/react/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "react",
          include: ["**/src/react/**/*.test.tsx"],
          exclude: excluded,
          environment: path.resolve(__dirname, "test/src/react/jsdom-node-fetch.ts"),
        },
      },
    ],
    coverage: {
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
