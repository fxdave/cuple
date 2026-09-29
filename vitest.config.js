import path from "node:path";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [viteTsConfigPaths()],
  resolve: {
    // Packages import each other by name too, which would otherwise load a
    // second copy from `dist` and break `instanceof` across them.
    alias: [
      {
        find: /^@cuple\/(client|server|inspect|openapi|mcp)$/,
        replacement: path.resolve(__dirname, "packages/$1/src/index.ts"),
      },
    ],
  },
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
